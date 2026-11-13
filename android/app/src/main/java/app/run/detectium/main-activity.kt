package app.run.detectium

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.run.detectium.ui.theme.DetectiumTheme

class MainActivity : ComponentActivity() {
  private val accessibilityEnabled = mutableStateOf(false)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    val preferences = getSharedPreferences(DetectiumAccessibilityService.PREFERENCES_NAME, MODE_PRIVATE)
    setContent {
      DetectiumTheme {
        var apiKeyInput by remember { mutableStateOf(preferences.getString("apiKey", "").orEmpty()) }
        var isEnabled by remember { mutableStateOf(preferences.getBoolean("isEnabled", true)) }
        var threshold by remember { mutableIntStateOf(preferences.getInt("detectionThreshold", 50)) }
        var consent by remember { mutableStateOf(preferences.getBoolean("contentConsent", false)) }
        var status by remember { mutableStateOf("접근성 서비스를 켜면 Instagram/X 앱에서 동작합니다.") }

        Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
          Column(
            modifier = Modifier
              .fillMaxSize()
              .padding(innerPadding)
              .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
          ) {
            Text("Detectium", style = MaterialTheme.typography.headlineSmall)
            Text(
              if (accessibilityEnabled.value) "백그라운드 앱 연동: 켜짐"
              else "백그라운드 앱 연동: 꺼짐",
              style = MaterialTheme.typography.titleMedium
            )
            Text(
              "Instagram/X 앱에서 화면에 표시된 텍스트 게시글을 감지합니다. " +
                "동의하면 현재 화면의 텍스트가 저장한 OpenAI API 키를 통해 OpenAI에 전송됩니다. " +
                "DM·댓글 등 현재 화면의 다른 텍스트도 포함될 수 있습니다. " +
                "이미지와 동영상 자체는 분석하지 않습니다.",
              style = MaterialTheme.typography.bodyMedium
            )
            Button(
              onClick = {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                status = "설정에서 Detectium 접근성 서비스를 직접 켜주세요."
              },
              modifier = Modifier.fillMaxWidth()
            ) {
              Text(if (accessibilityEnabled.value) "접근성 설정 열기" else "백그라운드 연동 설정")
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
              Checkbox(
                checked = consent,
                onCheckedChange = {
                  consent = it
                  preferences.edit().putBoolean("contentConsent", it).apply()
                  status = if (it) {
                    "텍스트 분석 전송에 동의했습니다."
                  } else {
                    "동의를 해제했습니다. 게시글 텍스트를 전송하지 않습니다."
                  }
                }
              )
              Text("현재 Instagram/X 화면 텍스트를 OpenAI로 전송")
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
              Checkbox(
                checked = isEnabled,
                onCheckedChange = {
                  isEnabled = it
                  preferences.edit().putBoolean("isEnabled", it).apply()
                  status = if (it) "실시간 검사를 켰습니다." else "실시간 검사를 껐습니다."
                }
              )
              Text("실시간 검사")
            }

            Row(
              modifier = Modifier.fillMaxWidth(),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.SpaceBetween
            ) {
              Text("위험도 기준")
              listOf(70, 50, 40).forEach { level ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                  RadioButton(
                    selected = threshold == level,
                    onClick = {
                      threshold = level
                      preferences.edit().putInt("detectionThreshold", level).apply()
                    }
                  )
                  Text("$level")
                }
              }
            }

            OutlinedTextField(
              value = apiKeyInput,
              onValueChange = { apiKeyInput = it },
              label = { Text("OpenAI API 키") },
              placeholder = { Text("sk-...") },
              singleLine = true,
              visualTransformation = PasswordVisualTransformation(),
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
              modifier = Modifier.fillMaxWidth()
            )
            Button(
              onClick = {
                preferences.edit().putString("apiKey", apiKeyInput.trim()).apply()
                status = "API 키를 이 기기에 저장했습니다."
              },
              modifier = Modifier.fillMaxWidth()
            ) {
              Text("API 키 저장")
            }

            Text(status, style = MaterialTheme.typography.bodySmall)
            Spacer(modifier = Modifier.weight(1f))
            Text(
              "연동은 Android 접근성 권한을 사용합니다. Detectium은 Instagram/X가 " +
                "화면에 열려 있을 때만 텍스트를 읽습니다. DM이나 댓글 화면에서는 사용하지 마세요. " +
                "전송 동의를 끄면 분석 요청을 보내지 않습니다.",
              style = MaterialTheme.typography.bodySmall
            )
          }
        }
      }
    }
  }

  override fun onResume() {
    super.onResume()
    val manager = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
    val expected = ComponentName(this, DetectiumAccessibilityService::class.java)
    accessibilityEnabled.value = manager
      .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      .any { service ->
        service.resolveInfo.serviceInfo.packageName == expected.packageName &&
          service.resolveInfo.serviceInfo.name == expected.className
      }
  }
}
