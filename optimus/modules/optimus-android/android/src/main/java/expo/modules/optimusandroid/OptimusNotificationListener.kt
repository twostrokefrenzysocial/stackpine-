package expo.modules.optimusandroid

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Captures posted notifications into [EncryptedQueue] when capture is enabled via [CaptureConfig].
 *
 * One-time passcodes are removed by [OtpRedactor] BEFORE anything is written to disk.
 * Declared in the app manifest by the config plugin (plugin/withOptimusAndroid.js).
 */
class OptimusNotificationListener : NotificationListenerService() {
  private var executor: ExecutorService? = null

  override fun onCreate() {
    super.onCreate()
    executor = Executors.newSingleThreadExecutor()
  }

  override fun onDestroy() {
    // Already-submitted tasks still run to completion after shutdown().
    executor?.shutdown()
    executor = null
    super.onDestroy()
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    Log.i(TAG, "Notification listener connected")
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    if (sbn == null) return
    val appContext = applicationContext
    val exec = executor
    try {
      if (exec != null && !exec.isShutdown) {
        exec.execute { handle(appContext, sbn) }
      } else {
        handle(appContext, sbn)
      }
    } catch (e: Throwable) {
      // A notification listener must never crash: the system would unbind it.
      Log.w(TAG, "Failed to schedule notification capture", e)
    }
  }

  private fun handle(context: Context, sbn: StatusBarNotification) {
    try {
      val config = CaptureConfig.read(context)
      if (!config.enabled) return

      val pkg = sbn.packageName ?: return
      if (pkg == context.packageName) return
      if (config.excludedPackages.contains(pkg)) return

      val notification = sbn.notification ?: return
      val flags = notification.flags
      if (flags and Notification.FLAG_GROUP_SUMMARY != 0) return
      if (flags and Notification.FLAG_ONGOING_EVENT != 0) return
      if (flags and Notification.FLAG_FOREGROUND_SERVICE != 0) return
      if (sbn.isOngoing) return

      val extras = notification.extras ?: Bundle()
      // Chat apps (Google Messages, Samsung Messages, WhatsApp...) post one
      // notification per conversation holding its recent messages. Capture each
      // message on its own, with the sender and the time it arrived, so RCS
      // chats that never reach the SMS database are still readable.
      val chatMessages = messagingStyleMessages(extras)
      if (chatMessages.isNotEmpty()) {
        val conversation = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()?.trim().orEmpty()
        val fallbackSender = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val baseKey = sbn.key ?: "$pkg:${sbn.id}"
        for (m in chatMessages) {
          val sender = m.sender.ifEmpty { fallbackSender }
          val title = if (conversation.isNotEmpty() && conversation != sender) "$sender · $conversation" else sender
          val at = if (m.time > 0) m.time else sbn.postTime
          if (Dedupe.isDuplicate("$baseKey#$at", title, m.text, at)) continue
          val redaction = OtpRedactor.redact(title.take(MAX_TITLE), m.text.take(MAX_TEXT))
          EncryptedQueue.append(
            context,
            JSONObject().apply {
              put("key", "$baseKey#$at")
              put("packageName", pkg)
              put("appName", appLabel(context, pkg))
              put("title", redaction.title)
              put("text", redaction.text)
              put("postedAtMs", at)
              put("category", notification.category ?: JSONObject.NULL)
              put("redacted", redaction.redacted)
            }
          )
        }
        return
      }
      val title = (
        extras.getCharSequence(Notification.EXTRA_TITLE)
          ?: extras.getCharSequence(Notification.EXTRA_TITLE_BIG)
        )?.toString()?.trim().orEmpty()

      var text = (
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
          ?: extras.getCharSequence(Notification.EXTRA_TEXT)
        )?.toString()?.trim().orEmpty()
      if (text.isEmpty()) {
        text = lastMessagingStyleText(extras).orEmpty()
      }

      if (title.isEmpty() && text.isEmpty()) return

      val postedAt = sbn.postTime
      val key = sbn.key ?: "$pkg:${sbn.id}"
      if (Dedupe.isDuplicate(key, title, text, postedAt)) return

      val redaction = OtpRedactor.redact(title.take(MAX_TITLE), text.take(MAX_TEXT))

      val entry = JSONObject().apply {
        put("key", key)
        put("packageName", pkg)
        put("appName", appLabel(context, pkg))
        put("title", redaction.title)
        put("text", redaction.text)
        put("postedAtMs", postedAt)
        put("category", notification.category ?: JSONObject.NULL)
        put("redacted", redaction.redacted)
      }
      EncryptedQueue.append(context, entry)
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to capture notification", e)
    }
  }

  private class ChatMessage(val text: String, val sender: String, val time: Long)

  /** Every message a MessagingStyle notification carries (oldest first), with sender and time. */
  private fun messagingStyleMessages(extras: Bundle): List<ChatMessage> {
    val messages: Array<out Parcelable>? = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        extras.getParcelableArray(Notification.EXTRA_MESSAGES, Parcelable::class.java)
      } else {
        @Suppress("DEPRECATION")
        extras.getParcelableArray(Notification.EXTRA_MESSAGES)
      }
    } catch (e: Throwable) {
      null
    }
    if (messages.isNullOrEmpty()) return emptyList()
    val out = ArrayList<ChatMessage>()
    for (item in messages) {
      val bundle = item as? Bundle ?: continue
      val text = bundle.getCharSequence("text")?.toString()?.trim().orEmpty()
      if (text.isEmpty()) continue
      val sender = (
        bundle.getCharSequence("sender")?.toString()
          ?: try {
            @Suppress("DEPRECATION")
            (bundle.getParcelable("sender_person") as? android.app.Person)?.name?.toString()
          } catch (e: Throwable) {
            null
          }
        )?.trim().orEmpty()
      out.add(ChatMessage(text, sender, bundle.getLong("time", 0L)))
    }
    return out
  }

  /** MessagingStyle notifications keep the conversation in EXTRA_MESSAGES (array of Bundles with "text"). */
  private fun lastMessagingStyleText(extras: Bundle): String? {
    val messages: Array<out Parcelable>? = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        extras.getParcelableArray(Notification.EXTRA_MESSAGES, Parcelable::class.java)
      } else {
        @Suppress("DEPRECATION")
        extras.getParcelableArray(Notification.EXTRA_MESSAGES)
      }
    } catch (e: Throwable) {
      null
    }
    if (messages.isNullOrEmpty()) return null
    for (i in messages.indices.reversed()) {
      val bundle = messages[i] as? Bundle ?: continue
      val msg = bundle.getCharSequence("text")?.toString()?.trim()
      if (!msg.isNullOrEmpty()) return msg
    }
    return null
  }

  private fun appLabel(context: Context, pkg: String): String {
    synchronized(labelCache) { labelCache[pkg] }?.let { return it }
    val label = try {
      val pm = context.packageManager
      val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
      } else {
        @Suppress("DEPRECATION")
        pm.getApplicationInfo(pkg, 0)
      }
      pm.getApplicationLabel(info).toString()
    } catch (e: Throwable) {
      // Package not visible (no QUERY_ALL_PACKAGES) or uninstalled: fall back to the package name.
      pkg
    }
    synchronized(labelCache) {
      if (labelCache.size > 500) labelCache.clear()
      labelCache[pkg] = label
    }
    return label
  }

  /** Skips re-posts of the same notification key with identical content within [WINDOW_MS]. */
  private object Dedupe {
    private const val WINDOW_MS = 2000L
    private const val MAX_KEYS = 512

    data class Seen(val contentHash: Int, val postedAt: Long)

    private val seen = object : LinkedHashMap<String, Seen>(64, 0.75f, true) {
      override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Seen>?): Boolean = size > MAX_KEYS
    }

    @Synchronized
    fun isDuplicate(key: String, title: String, text: String, postedAt: Long): Boolean {
      val hash = (title + "\u0000" + text).hashCode()
      val previous = seen[key]
      seen[key] = Seen(hash, postedAt)
      return previous != null &&
        previous.contentHash == hash &&
        kotlin.math.abs(postedAt - previous.postedAt) < WINDOW_MS
    }
  }

  companion object {
    private const val TAG = "OptimusNotifListener"
    private const val MAX_TITLE = 500
    private const val MAX_TEXT = 4000

    private val labelCache = HashMap<String, String>()

    fun componentName(context: Context): ComponentName =
      ComponentName(context.applicationContext, OptimusNotificationListener::class.java)
  }
}
