package expo.modules.optimusandroid

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Append-only, line-oriented queue of captured notifications.
 *
 * File: `<noBackupFilesDir>/optimus_notif_queue`. Each line is
 * `base64(iv || AES-256-GCM ciphertext)` of one JSON object. The key lives in the
 * AndroidKeyStore under [KEY_ALIAS] and never leaves secure hardware.
 *
 * The listener service and the JS module run in the same process, so a single
 * process-wide monitor ([lock]) serialises every read/write of the file.
 */
object EncryptedQueue {
  private const val TAG = "OptimusEncryptedQueue"
  private const val FILE_NAME = "optimus_notif_queue"
  private const val KEYSTORE = "AndroidKeyStore"
  const val KEY_ALIAS = "optimus_notif_queue_key"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val IV_LENGTH = 12
  private const val TAG_LENGTH_BITS = 128

  /** Maximum number of entries kept; the oldest entries are dropped first. */
  const val MAX_ENTRIES = 5000

  /** Let the file grow a little past the cap before rewriting it, to avoid a rewrite per append. */
  private const val TRIM_SLACK = 250

  private val lock = Any()

  /** Cached line count of the file, or -1 when unknown. Guarded by [lock]. */
  private var lineCount = -1

  private fun file(context: Context): File = File(context.applicationContext.noBackupFilesDir, FILE_NAME)

  // region Key management

  // Locks on the EncryptedQueue object itself (not [lock]) so two callers never generate competing keys.
  @Synchronized
  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setKeySize(256)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build()
    generator.init(spec)
    return generator.generateKey()
  }

  private fun encrypt(key: SecretKey, plain: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    // The keystore generates a random IV (randomized encryption is required by default).
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    val out = ByteArray(iv.size + ciphertext.size)
    System.arraycopy(iv, 0, out, 0, iv.size)
    System.arraycopy(ciphertext, 0, out, iv.size, ciphertext.size)
    return Base64.encodeToString(out, Base64.NO_WRAP)
  }

  private fun decrypt(key: SecretKey, line: String): String {
    val bytes = Base64.decode(line, Base64.NO_WRAP)
    require(bytes.size > IV_LENGTH) { "Queue entry too short" }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH_BITS, bytes, 0, IV_LENGTH))
    val plain = cipher.doFinal(bytes, IV_LENGTH, bytes.size - IV_LENGTH)
    return String(plain, Charsets.UTF_8)
  }

  // endregion

  /** Encrypts [entry] and appends it as one line. Never throws. */
  fun append(context: Context, entry: JSONObject) {
    synchronized(lock) {
      try {
        val f = file(context)
        val line = encrypt(getOrCreateKey(), entry.toString())
        f.appendText(line + "\n", Charsets.UTF_8)

        if (lineCount < 0) {
          lineCount = countLines(f)
        } else {
          lineCount += 1
        }
        if (lineCount > MAX_ENTRIES + TRIM_SLACK) {
          trimLocked(f)
        }
      } catch (e: Throwable) {
        Log.w(TAG, "Failed to append notification to queue", e)
      }
    }
  }

  /**
   * Returns every queued entry (oldest first, at most [MAX_ENTRIES]) and clears the queue.
   * Entries that cannot be decrypted (e.g. the key was wiped) are skipped.
   */
  fun drain(context: Context): List<JSONObject> {
    val lines: List<String> = synchronized(lock) {
      val f = file(context)
      val read: List<String> = try {
        if (f.exists()) f.readLines(Charsets.UTF_8) else emptyList()
      } catch (e: Throwable) {
        Log.w(TAG, "Failed to read notification queue", e)
        emptyList()
      }
      try {
        if (f.exists() && !f.delete()) {
          f.writeText("", Charsets.UTF_8)
        }
      } catch (e: Throwable) {
        Log.w(TAG, "Failed to clear notification queue", e)
      }
      lineCount = 0
      read
    }

    val nonEmpty = lines.filter { it.isNotBlank() }.takeLast(MAX_ENTRIES)
    if (nonEmpty.isEmpty()) {
      return emptyList()
    }

    val key = try {
      getOrCreateKey()
    } catch (e: Throwable) {
      Log.w(TAG, "Queue key unavailable", e)
      return emptyList()
    }

    val result = ArrayList<JSONObject>(nonEmpty.size)
    for (line in nonEmpty) {
      try {
        result.add(JSONObject(decrypt(key, line.trim())))
      } catch (e: Throwable) {
        Log.w(TAG, "Skipping undecryptable queue entry", e)
      }
    }
    return result
  }

  private fun countLines(f: File): Int {
    if (!f.exists()) return 0
    var count = 0
    f.forEachLine(Charsets.UTF_8) { if (it.isNotBlank()) count++ }
    return count
  }

  /** Keeps only the newest [MAX_ENTRIES] lines. Caller must hold [lock]. */
  private fun trimLocked(f: File) {
    val kept = f.readLines(Charsets.UTF_8).filter { it.isNotBlank() }.takeLast(MAX_ENTRIES)
    val tmp = File(f.parentFile, "$FILE_NAME.tmp")
    tmp.writeText(if (kept.isEmpty()) "" else kept.joinToString("\n", postfix = "\n"), Charsets.UTF_8)
    if (!tmp.renameTo(f)) {
      // renameTo over an existing file works on Android's filesystems, but be defensive.
      f.writeText(tmp.readText(Charsets.UTF_8), Charsets.UTF_8)
      tmp.delete()
    }
    lineCount = kept.size
  }
}
