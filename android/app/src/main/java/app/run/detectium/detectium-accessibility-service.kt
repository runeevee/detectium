package app.run.detectium

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

class DetectiumAccessibilityService : AccessibilityService() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val executor = Executors.newSingleThreadExecutor()
  private val windowManager by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
  private val analyzedIds = LinkedHashMap<String, Long>()
  private val overlays = mutableMapOf<String, View>()
  private var lastPackage: String? = null
  private var lastNoKeyNotice = 0L

  private val scanRunnable = Runnable { scanCurrentScreen() }

  override fun onServiceConnected() {
    super.onServiceConnected()
    serviceInfo = serviceInfo.apply {
      packageNames = TARGET_PACKAGES
      eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
        AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
        AccessibilityEvent.TYPE_VIEW_SCROLLED or
        AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
      feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
      notificationTimeout = 400
      flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
        AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val packageName = event?.packageName?.toString() ?: return
    if (packageName !in TARGET_PACKAGES) return

    if (lastPackage != packageName) {
      removeAllOverlays()
      lastPackage = packageName
    }
    mainHandler.removeCallbacks(scanRunnable)
    mainHandler.postDelayed(scanRunnable, SCAN_DEBOUNCE_MS)
  }

  override fun onInterrupt() {
    mainHandler.removeCallbacks(scanRunnable)
    removeAllOverlays()
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    mainHandler.removeCallbacksAndMessages(null)
    removeAllOverlays()
    executor.shutdownNow()
    return super.onUnbind(intent)
  }

  @Suppress("DEPRECATION")
  private fun scanCurrentScreen() {
    val root = rootInActiveWindow ?: return
    try {
      val packageName = root.packageName?.toString() ?: return
      if (packageName !in TARGET_PACKAGES) return

      val preferences = getSharedPreferences(PREFERENCES_NAME, MODE_PRIVATE)
      if (!preferences.getBoolean("isEnabled", true) ||
        !preferences.getBoolean("contentConsent", false)
      ) {
        return
      }

      val apiKey = preferences.getString("apiKey", "").orEmpty().trim()
      if (apiKey.isEmpty()) {
        val now = System.currentTimeMillis()
        if (now - lastNoKeyNotice > NO_KEY_NOTICE_INTERVAL_MS) {
          lastNoKeyNotice = now
          Toast.makeText(this, "Detectium에 OpenAI API 키를 저장해주세요.", Toast.LENGTH_SHORT).show()
        }
        return
      }

      val screen = Rect(0, 0, resources.displayMetrics.widthPixels, resources.displayMetrics.heightPixels)
      val candidates = extractVisiblePosts(root, screen)
        .filter { post -> synchronized(analyzedIds) { analyzedIds[post.id] == null } }
        .take(MAX_POSTS_PER_BATCH)
      if (candidates.isEmpty()) return

      synchronized(analyzedIds) {
        candidates.forEach { analyzedIds[it.id] = System.currentTimeMillis() }
      }
      trimAnalyzedIds()
      executor.execute { analyze(candidates, apiKey, preferences.getInt("detectionThreshold", 50)) }
    } finally {
      root.recycle()
    }
  }

  @Suppress("DEPRECATION")
  private fun extractVisiblePosts(root: AccessibilityNodeInfo, screen: Rect): List<VisiblePost> {
    val groups = LinkedHashMap<String, PostGroup>()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue.add(AccessibilityNodeInfo.obtain(root))
    var visited = 0

    while (queue.isNotEmpty() && visited++ < MAX_NODES_PER_SCAN) {
      val node = queue.removeFirst()
      try {
        val description = if (node.className?.toString()?.contains("Image", ignoreCase = true) == true) {
          null
        } else {
          node.contentDescription?.toString()
        }
        val text = sequenceOf(node.text?.toString(), description)
          .filterNotNull()
          .map { it.replace(Regex("\\s+"), " ").trim() }
          .filter { it.length >= MIN_TEXT_LENGTH && !it.isUiAction() }
          .distinct()
          .joinToString(" ")

        if (text.isNotBlank()) {
          val group = findPostGroup(node, root, screen)
          if (group != null) {
            val key = "${group.bounds.left}:${group.bounds.top}:${group.bounds.right}:${group.bounds.bottom}"
            val existing = groups.getOrPut(key) { group }
            existing.texts.add(text)
          }
        }

        for (index in 0 until node.childCount) {
          node.getChild(index)?.let(queue::add)
        }
      } finally {
        node.recycle()
      }
    }

    return groups.values.mapNotNull { group ->
      val content = group.texts.distinct().joinToString("\n").take(MAX_POST_TEXT_LENGTH)
      if (content.length < MIN_TEXT_LENGTH) return@mapNotNull null
      val visibleBounds = Rect(group.bounds)
      if (!visibleBounds.intersect(screen)) return@mapNotNull null
      val platform = if (lastPackage == INSTAGRAM_PACKAGE) "instagram" else "x"
      val id = "$platform-${content.hashCode().toUInt().toString(16)}"
      VisiblePost(id, platform, content, visibleBounds)
    }
  }

  @Suppress("DEPRECATION")
  private fun findPostGroup(
    source: AccessibilityNodeInfo,
    root: AccessibilityNodeInfo,
    screen: Rect
  ): PostGroup? {
    val bounds = Rect()
    var current: AccessibilityNodeInfo? = AccessibilityNodeInfo.obtain(source)
    var selectedBounds: Rect? = null
    val minHeight = (resources.displayMetrics.density * MIN_POST_HEIGHT_DP).toInt()
    val maxHeight = (screen.height() * MAX_POST_HEIGHT_RATIO).toInt()

    try {
      while (current != null) {
        current.getBoundsInScreen(bounds)
        if (bounds.width() >= (screen.width() * MIN_POST_WIDTH_RATIO).toInt() &&
          bounds.height() in minHeight..maxHeight &&
          bounds.intersect(screen)
        ) {
          selectedBounds = Rect(bounds)
          if (current == root) break
        }
        if (current == root) break
        val parent = current.parent
        current.recycle()
        current = parent
      }
    } finally {
      current?.recycle()
    }

    return selectedBounds?.let { PostGroup(it) }
  }

  private fun analyze(posts: List<VisiblePost>, apiKey: String, threshold: Int) {
    try {
      val input = posts.map { post ->
        SocialPost(post.id, post.platform, post.text, emptyList())
      }
      val results = OpenAiService(apiKey).analyzePosts(input)
      val resultsById = results.associateBy { it.id }
      posts.forEach { post ->
        val result = resultsById[post.id]
        if (result == null) {
          Log.w(TAG, "Analysis response omitted post ${post.id}")
          synchronized(analyzedIds) { analyzedIds.remove(post.id) }
        } else if (result.riskScore >= threshold) {
          mainHandler.post { showWarning(post, result.riskScore, result.description) }
        }
      }
    } catch (error: Exception) {
      Log.e(TAG, "Fact-check request failed", error)
      synchronized(analyzedIds) { posts.forEach { analyzedIds.remove(it.id) } }
      mainHandler.post {
        Toast.makeText(
          this,
          "Detectium 분석 실패: ${error.message ?: "네트워크 오류"}",
          Toast.LENGTH_LONG
        ).show()
      }
    }
  }

  private fun showWarning(post: VisiblePost, riskScore: Int, description: String) {
    if (lastPackage !in TARGET_PACKAGES || overlays.containsKey(post.id)) return

    val density = resources.displayMetrics.density
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding((16 * density).toInt(), (12 * density).toInt(), (16 * density).toInt(), (10 * density).toInt())
      background = GradientDrawable().apply {
        setColor(Color.argb(238, 153, 27, 27))
        cornerRadius = 12 * density
      }
      elevation = 8 * density
    }
    panel.addView(TextView(this).apply {
      text = "Detectium · 위험도 $riskScore"
      setTextColor(Color.WHITE)
      textSize = 15f
      setTypeface(typeface, Typeface.BOLD)
    })
    panel.addView(TextView(this).apply {
      text = description
      setTextColor(Color.WHITE)
      textSize = 13f
      maxLines = 5
      setPadding(0, (6 * density).toInt(), 0, (4 * density).toInt())
    })
    panel.addView(Button(this).apply {
      text = "확인하고 계속 보기"
      setOnClickListener { removeOverlay(post.id) }
    })

    val params = WindowManager.LayoutParams(
      (resources.displayMetrics.widthPixels - 32 * density).toInt(),
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      android.graphics.PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = post.bounds.top.coerceAtLeast((48 * density).toInt())
    }

    try {
      windowManager.addView(panel, params)
      overlays[post.id] = panel
    } catch (error: RuntimeException) {
      Log.e(TAG, "Could not display analysis warning", error)
    }
  }

  private fun removeOverlay(id: String) {
    overlays.remove(id)?.let { view ->
      runCatching { windowManager.removeView(view) }
        .onFailure { Log.w(TAG, "Could not remove warning overlay", it) }
    }
  }

  private fun removeAllOverlays() {
    overlays.keys.toList().forEach(::removeOverlay)
  }

  private fun trimAnalyzedIds() {
    synchronized(analyzedIds) {
      while (analyzedIds.size > MAX_REMEMBERED_POSTS) {
        analyzedIds.remove(analyzedIds.keys.first())
      }
    }
  }

  private fun String.isUiAction(): Boolean =
    length < 80 && lowercase() in UI_ACTIONS

  private data class VisiblePost(
    val id: String,
    val platform: String,
    val text: String,
    val bounds: Rect
  )

  private data class PostGroup(
    val bounds: Rect,
    val texts: MutableList<String> = mutableListOf()
  )

  companion object {
    const val PREFERENCES_NAME = "detectium_settings"
    private const val TAG = "Detectium"
    private const val INSTAGRAM_PACKAGE = "com.instagram.android"
    private const val X_PACKAGE = "com.twitter.android"
    private val TARGET_PACKAGES = arrayOf(INSTAGRAM_PACKAGE, X_PACKAGE)
    private const val SCAN_DEBOUNCE_MS = 850L
    private const val NO_KEY_NOTICE_INTERVAL_MS = 30_000L
    private const val MIN_TEXT_LENGTH = 20
    private const val MAX_POST_TEXT_LENGTH = 20_000
    private const val MAX_NODES_PER_SCAN = 2_000
    private const val MAX_POSTS_PER_BATCH = 5
    private const val MAX_REMEMBERED_POSTS = 500
    private const val MIN_POST_HEIGHT_DP = 80
    private const val MIN_POST_WIDTH_RATIO = 0.65f
    private const val MAX_POST_HEIGHT_RATIO = 0.75f
    private val UI_ACTIONS = setOf(
      "like", "reply", "repost", "share", "답글", "답글 달기", "좋아요", "공유", "더 보기"
    )
  }
}
