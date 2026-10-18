package expo.modules.optimusandroid

import android.content.Context
import android.content.SharedPreferences

/**
 * Notification-capture settings, written by the JS side through
 * `setNotificationCaptureConfig` and read by [OptimusNotificationListener].
 *
 * Stored in plain SharedPreferences: it contains no personal data, only a flag and
 * a list of package names.
 */
object CaptureConfig {
  private const val PREFS_NAME = "optimus_capture_config"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_EXCLUDED = "excluded_packages"

  data class Snapshot(val enabled: Boolean, val excludedPackages: Set<String>)

  @Volatile
  private var cached: Snapshot? = null

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun write(context: Context, enabled: Boolean, excludedPackages: Collection<String>) {
    val cleaned = excludedPackages.map { it.trim() }.filter { it.isNotEmpty() }.toSet()
    prefs(context)
      .edit()
      .putBoolean(KEY_ENABLED, enabled)
      .putStringSet(KEY_EXCLUDED, HashSet(cleaned))
      .apply()
    cached = Snapshot(enabled, cleaned)
  }

  fun read(context: Context): Snapshot {
    cached?.let { return it }
    val p = prefs(context)
    // getStringSet's result must not be modified, so copy it.
    val excluded = p.getStringSet(KEY_EXCLUDED, emptySet())?.toSet() ?: emptySet()
    val snapshot = Snapshot(p.getBoolean(KEY_ENABLED, false), excluded)
    cached = snapshot
    return snapshot
  }
}
