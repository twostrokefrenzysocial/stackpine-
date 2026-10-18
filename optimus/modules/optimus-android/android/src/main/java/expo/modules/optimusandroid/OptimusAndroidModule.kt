package expo.modules.optimusandroid

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

class PermissionMissingException(permission: String) :
  CodedException("ERR_PERMISSION_DENIED", "Missing Android permission $permission", null)

class OptimusAndroidModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OptimusAndroid")

    AsyncFunction("getSmsMessages") { opts: SmsQueryOptions ->
      requirePermission(Manifest.permission.READ_SMS)
      SmsReader(context.contentResolver).read(opts)
    }

    AsyncFunction("sendSms") { to: String, body: String ->
      requirePermission(Manifest.permission.SEND_SMS)
      val manager: SmsManager =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          context.getSystemService(SmsManager::class.java)
            ?: throw CodedException("ERR_SMS_UNAVAILABLE", "This device can't send SMS", null)
        } else {
          @Suppress("DEPRECATION")
          SmsManager.getDefault()
        }
      val parts = manager.divideMessage(body)
      if (parts.size > 1) {
        manager.sendMultipartTextMessage(to, null, parts, null, null)
      } else {
        manager.sendTextMessage(to, null, body, null, null)
      }
      mapOf("id" to "sent:${UUID.randomUUID()}")
    }

    AsyncFunction("getCallLog") { opts: CallLogQueryOptions ->
      requirePermission(Manifest.permission.READ_CALL_LOG)
      CallLogReader(context.contentResolver).read(opts)
    }

    AsyncFunction("startCall") { number: String ->
      val uri = Uri.parse("tel:" + Uri.encode(number))
      val action = if (granted(Manifest.permission.CALL_PHONE)) Intent.ACTION_CALL else Intent.ACTION_DIAL
      val intent = Intent(action, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("getDeviceStatus") {
      val installer = installerPackage()
      val sideloaded = installer == null || installer !in STORE_INSTALLERS
      val listenerGranted = notificationAccessGranted()
      mapOf(
        "sdkInt" to Build.VERSION.SDK_INT,
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "installerPackage" to installer,
        "isSideloaded" to sideloaded,
        "notificationAccessGranted" to listenerGranted,
        "restrictedSettingsLikelyBlocked" to restrictedSettingsBlocked(sideloaded, listenerGranted),
        "ignoringBatteryOptimizations" to ignoringBatteryOptimizations()
      )
    }

    Function("openNotificationAccessSettings") {
      val component = OptimusNotificationListener.componentName(context)
      val detail =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
        } else {
          null
        }
      if (detail == null || !tryStart(detail)) {
        tryStart(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
      }
    }

    Function("openAppDetailsSettings") {
      tryStart(appDetailsIntent())
    }

    Function("openBatteryOptimizationSettings") {
      @Suppress("BatteryLife")
      val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
      if (!tryStart(direct) && !tryStart(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
        tryStart(appDetailsIntent())
      }
    }

    Function("setNotificationCaptureConfig") { cfg: Map<String, Any?> ->
      val enabled = cfg["enabled"] as? Boolean ?: false
      val excluded = (cfg["excludedPackages"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
      CaptureConfig.write(context, enabled, excluded)
    }

    AsyncFunction("drainCapturedNotifications") {
      EncryptedQueue.drain(context).map { o ->
        mapOf(
          "key" to o.optString("key"),
          "packageName" to o.optString("packageName"),
          "appName" to o.optString("appName"),
          "title" to o.optString("title"),
          "text" to o.optString("text"),
          "postedAtMs" to o.optLong("postedAtMs").toDouble(),
          "category" to if (o.isNull("category")) null else o.optString("category"),
          "redacted" to o.optBoolean("redacted")
        )
      }
    }

    Function("requestListenerRebind") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        try {
          NotificationListenerService.requestRebind(OptimusNotificationListener.componentName(context))
        } catch (e: Throwable) {
          Log.w(TAG, "requestRebind failed", e)
        }
      }
    }
  }

  // ---------- helpers ----------

  private fun granted(permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  private fun requirePermission(permission: String) {
    if (!granted(permission)) throw PermissionMissingException(permission)
  }

  private fun tryStart(intent: Intent): Boolean =
    try {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Throwable) {
      Log.w(TAG, "Could not open ${intent.action}", e)
      false
    }

  private fun appDetailsIntent(): Intent =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))

  private fun installerPackage(): String? =
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(context.packageName)
      }
    } catch (e: Throwable) {
      null
    }

  private fun notificationAccessGranted(): Boolean {
    val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
    val mine = OptimusNotificationListener.componentName(context)
    return flat.split(":").any { entry ->
      val parsed = android.content.ComponentName.unflattenFromString(entry)
      parsed != null && parsed.packageName == mine.packageName && parsed.className == mine.className
    }
  }

  /**
   * Android 13+ blocks notification-listener access for sideloaded apps until the
   * user taps "Allow restricted settings" in the app's info screen. The app op is
   * hidden, so fall back to a heuristic when it can't be read.
   */
  private fun restrictedSettingsBlocked(sideloaded: Boolean, listenerGranted: Boolean): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || listenerGranted) return false
    try {
      val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = ops.unsafeCheckOpNoThrow("android:access_restricted_settings", Process.myUid(), context.packageName)
      if (mode == AppOpsManager.MODE_ALLOWED) return false
      if (mode == AppOpsManager.MODE_ERRORED || mode == AppOpsManager.MODE_IGNORED) return sideloaded
    } catch (e: Throwable) {
      // Hidden op not available on this build; use the heuristic below.
    }
    return sideloaded
  }

  private fun ignoringBatteryOptimizations(): Boolean {
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isIgnoringBatteryOptimizations(context.packageName)
  }

  companion object {
    private const val TAG = "OptimusAndroid"
    private val STORE_INSTALLERS = setOf("com.android.vending", "com.sec.android.app.samsungapps", "com.amazon.venezia")
  }
}
