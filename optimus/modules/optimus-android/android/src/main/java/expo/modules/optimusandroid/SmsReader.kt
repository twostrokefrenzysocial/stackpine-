package expo.modules.optimusandroid

import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.Telephony
import android.util.Log
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Locale

class SmsQueryOptions : Record {
  /** Only messages with date strictly greater than this (epoch ms). */
  @Field
  var sinceMs: Double? = null

  /** Only messages with date strictly less than this (epoch ms): pages back through long threads. */
  @Field
  var untilMs: Double? = null

  /** Default 200, clamped to 1..1000. */
  @Field
  var limit: Int? = null

  /** Case-insensitive substring match on body or address. */
  @Field
  var query: String? = null

  @Field
  var threadId: String? = null
}

/**
 * Reads SMS from `content://sms` and (best effort) the text parts of MMS from `content://mms`.
 *
 * Ids are prefixed ("sms:<_id>", "mms:<_id>") because the two tables have independent id spaces.
 */
class SmsReader(private val resolver: ContentResolver) {
  companion object {
    private const val TAG = "OptimusSmsReader"
    const val DEFAULT_LIMIT = 200
    const val MAX_LIMIT = 1000

    // MMS address types (PduHeaders.FROM / PduHeaders.TO).
    private const val MMS_ADDR_FROM = 137
    private const val MMS_ADDR_TO = 151

    // Telephony.BaseMmsColumns.MESSAGE_BOX_* values.
    private const val MMS_BOX_INBOX = 1
    private const val MMS_BOX_SENT = 2
    private const val MMS_BOX_DRAFTS = 3
    private const val MMS_BOX_OUTBOX = 4
    private const val MMS_BOX_FAILED = 5

    private val MMS_URI: Uri = Uri.parse("content://mms")
    private val MMS_PART_URI: Uri = Uri.parse("content://mms/part")

    /**
     * Samsung Messages keeps RCS chats in its own (undocumented) provider rather
     * than the SMS database. Columns seen in the wild: _id, msg_id, address,
     * body, date, type, read. Everything about it is best effort.
     */
    private val SAMSUNG_RCS_URI: Uri = Uri.parse("content://im/chat")

    fun clampLimit(limit: Int?): Int = (limit ?: DEFAULT_LIMIT).coerceIn(1, MAX_LIMIT)

    /** Escapes LIKE wildcards so user input is matched literally (used with ESCAPE '\'). */
    fun escapeLike(input: String): String =
      input.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
  }

  fun read(opts: SmsQueryOptions): List<Map<String, Any?>> {
    val limit = clampLimit(opts.limit)
    val query = opts.query?.trim()?.takeIf { it.isNotEmpty() }
    val threadId = opts.threadId?.trim()?.takeIf { it.isNotEmpty() }
    val sinceMs = opts.sinceMs?.toLong()
    val untilMs = opts.untilMs?.toLong()

    val sms = readSms(limit, sinceMs, untilMs, query, threadId)
    val mms = try {
      readMms(limit, sinceMs, untilMs, query, threadId)
    } catch (e: Throwable) {
      // MMS is best effort: some OEM providers reject these queries.
      Log.w(TAG, "Failed to read MMS", e)
      emptyList()
    }
    val rcs = try {
      readSamsungRcs(limit, sinceMs, untilMs, query)
    } catch (e: Throwable) {
      // Only present when Samsung Messages is the RCS client.
      Log.i(TAG, "Samsung RCS provider not readable: ${e.message}")
      emptyList()
    }

    return (sms + mms + rcs)
      .sortedByDescending { (it["dateMs"] as Double) }
      .take(limit)
  }

  /**
   * What this phone lets us see, for Settings and for the model's own
   * honesty about gaps: row counts per store, and the default SMS app.
   */
  fun diagnostics(): Map<String, Any?> {
    fun count(uri: Uri): Any = try {
      resolver.query(uri, arrayOf("_id"), null, null, null)?.use { it.count } ?: "unavailable"
    } catch (e: Throwable) {
      "unavailable"
    }
    return mapOf(
      "sms" to count(Telephony.Sms.CONTENT_URI),
      "mms" to count(MMS_URI),
      "samsungRcs" to count(SAMSUNG_RCS_URI)
    )
  }

  // region Samsung RCS (best effort)

  private fun readSamsungRcs(limit: Int, sinceMs: Long?, untilMs: Long?, query: String?): List<Map<String, Any?>> {
    val out = ArrayList<Map<String, Any?>>()
    val needle = query?.lowercase(Locale.ROOT)
    resolver.query(SAMSUNG_RCS_URI, null, null, null, "date DESC")?.use { c ->
      val idIdx = c.getColumnIndex("_id")
      val addressIdx = c.getColumnIndex("address")
      val bodyIdx = c.getColumnIndex("body")
      val dateIdx = c.getColumnIndex("date")
      val typeIdx = c.getColumnIndex("type")
      val readIdx = c.getColumnIndex("read")
      val threadIdx = c.getColumnIndex("thread_id").takeIf { it >= 0 } ?: c.getColumnIndex("chat_session_id")
      if (idIdx < 0 || bodyIdx < 0 || dateIdx < 0) return emptyList()
      var scanned = 0
      while (c.moveToNext() && out.size < limit && scanned < 5000) {
        scanned++
        var dateMs = c.getLong(dateIdx)
        if (dateMs in 1..99_999_999_999L) dateMs *= 1000L // seconds
        if (sinceMs != null && dateMs <= sinceMs) continue
        if (untilMs != null && dateMs >= untilMs) continue
        val body = c.stringOrEmpty(bodyIdx)
        val address = if (addressIdx >= 0) c.stringOrEmpty(addressIdx) else ""
        if (body.isEmpty()) continue
        if (needle != null && !body.lowercase(Locale.ROOT).contains(needle) && !address.lowercase(Locale.ROOT).contains(needle)) continue
        val type = if (typeIdx >= 0 && !c.isNull(typeIdx)) c.getInt(typeIdx) else -1
        out.add(
          mapOf(
            "id" to "rcs:${c.getLong(idIdx)}",
            "threadId" to (if (threadIdx >= 0) "rcs:${c.stringOrEmpty(threadIdx)}" else "rcs:$address"),
            "address" to address,
            "body" to body,
            "dateMs" to dateMs.toDouble(),
            "type" to smsType(type),
            "read" to (readIdx < 0 || c.isNull(readIdx) || c.getInt(readIdx) != 0),
            "kind" to "rcs"
          )
        )
      }
    }
    return out
  }

  // endregion

  // region SMS

  private fun readSms(limit: Int, sinceMs: Long?, untilMs: Long?, query: String?, threadId: String?): List<Map<String, Any?>> {
    val selection = StringBuilder()
    val args = ArrayList<String>()
    fun addClause(clause: String) {
      if (selection.isNotEmpty()) selection.append(" AND ")
      selection.append(clause)
    }

    if (sinceMs != null) {
      addClause("${Telephony.Sms.DATE} > ?")
      args.add(sinceMs.toString())
    }
    if (untilMs != null) {
      addClause("${Telephony.Sms.DATE} < ?")
      args.add(untilMs.toString())
    }
    if (threadId != null) {
      addClause("${Telephony.Sms.THREAD_ID} = ?")
      args.add(threadId)
    }
    if (query != null) {
      // SQLite LIKE is case-insensitive for ASCII.
      addClause("(${Telephony.Sms.BODY} LIKE ? ESCAPE '\\' OR ${Telephony.Sms.ADDRESS} LIKE ? ESCAPE '\\')")
      val like = "%${escapeLike(query)}%"
      args.add(like)
      args.add(like)
    }

    val projection = arrayOf(
      Telephony.Sms._ID,
      Telephony.Sms.THREAD_ID,
      Telephony.Sms.ADDRESS,
      Telephony.Sms.BODY,
      Telephony.Sms.DATE,
      Telephony.Sms.TYPE,
      Telephony.Sms.READ
    )

    val out = ArrayList<Map<String, Any?>>()
    // No "LIMIT" in sortOrder: not every OEM provider accepts it. We stop iterating instead.
    resolver.query(
      Telephony.Sms.CONTENT_URI,
      projection,
      selection.toString().ifEmpty { null },
      if (args.isEmpty()) null else args.toTypedArray(),
      "${Telephony.Sms.DATE} DESC"
    )?.use { c ->
      val idIdx = c.getColumnIndexOrThrow(Telephony.Sms._ID)
      val threadIdx = c.getColumnIndexOrThrow(Telephony.Sms.THREAD_ID)
      val addressIdx = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
      val bodyIdx = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
      val dateIdx = c.getColumnIndexOrThrow(Telephony.Sms.DATE)
      val typeIdx = c.getColumnIndexOrThrow(Telephony.Sms.TYPE)
      val readIdx = c.getColumnIndexOrThrow(Telephony.Sms.READ)
      while (c.moveToNext() && out.size < limit) {
        out.add(
          mapOf(
            "id" to "sms:${c.getLong(idIdx)}",
            "threadId" to c.stringOrEmpty(threadIdx),
            "address" to c.stringOrEmpty(addressIdx),
            "body" to c.stringOrEmpty(bodyIdx),
            "dateMs" to c.getLong(dateIdx).toDouble(),
            "type" to smsType(if (c.isNull(typeIdx)) -1 else c.getInt(typeIdx)),
            "read" to (!c.isNull(readIdx) && c.getInt(readIdx) != 0),
            "kind" to "sms"
          )
        )
      }
    }
    return out
  }

  private fun smsType(type: Int): String = when (type) {
    Telephony.Sms.MESSAGE_TYPE_INBOX -> "inbox"
    Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
    Telephony.Sms.MESSAGE_TYPE_DRAFT -> "draft"
    Telephony.Sms.MESSAGE_TYPE_OUTBOX -> "outbox"
    Telephony.Sms.MESSAGE_TYPE_FAILED -> "failed"
    Telephony.Sms.MESSAGE_TYPE_QUEUED -> "queued"
    else -> "other"
  }

  // endregion

  // region MMS (best effort)

  private fun readMms(limit: Int, sinceMs: Long?, untilMs: Long?, query: String?, threadId: String?): List<Map<String, Any?>> {
    val selection = StringBuilder()
    val args = ArrayList<String>()
    fun addClause(clause: String) {
      if (selection.isNotEmpty()) selection.append(" AND ")
      selection.append(clause)
    }
    if (sinceMs != null) {
      // MMS dates are stored in SECONDS. Inclusive on the second boundary, then filtered in ms below;
      // ids are stable, so callers should upsert by id.
      addClause("${Telephony.Mms.DATE} >= ?")
      args.add((sinceMs / 1000).toString())
    }
    if (threadId != null) {
      addClause("${Telephony.Mms.THREAD_ID} = ?")
      args.add(threadId)
    }

    val projection = arrayOf(
      Telephony.Mms._ID,
      Telephony.Mms.THREAD_ID,
      Telephony.Mms.DATE,
      Telephony.Mms.MESSAGE_BOX,
      Telephony.Mms.READ
    )

    // With a text query we must inspect bodies in code, so scan more rows (bounded).
    val scanCap = if (query != null) (limit * 5).coerceAtMost(2000) else limit
    val needle = query?.lowercase(Locale.ROOT)
    val out = ArrayList<Map<String, Any?>>()
    var scanned = 0

    resolver.query(
      MMS_URI,
      projection,
      selection.toString().ifEmpty { null },
      if (args.isEmpty()) null else args.toTypedArray(),
      "${Telephony.Mms.DATE} DESC"
    )?.use { c ->
      val idIdx = c.getColumnIndexOrThrow(Telephony.Mms._ID)
      val threadIdx = c.getColumnIndexOrThrow(Telephony.Mms.THREAD_ID)
      val dateIdx = c.getColumnIndexOrThrow(Telephony.Mms.DATE)
      val boxIdx = c.getColumnIndexOrThrow(Telephony.Mms.MESSAGE_BOX)
      val readIdx = c.getColumnIndexOrThrow(Telephony.Mms.READ)
      while (c.moveToNext() && out.size < limit && scanned < scanCap) {
        scanned++
        val id = c.getLong(idIdx)
        val dateMs = c.getLong(dateIdx) * 1000L
        if (sinceMs != null && dateMs < (sinceMs / 1000) * 1000) continue
        if (untilMs != null && dateMs >= untilMs) continue
        val box = if (c.isNull(boxIdx)) -1 else c.getInt(boxIdx)
        val body = mmsText(id)
        val address = mmsAddress(id, box)
        if (needle != null &&
          !body.lowercase(Locale.ROOT).contains(needle) &&
          !address.lowercase(Locale.ROOT).contains(needle)
        ) {
          continue
        }
        out.add(
          mapOf(
            "id" to "mms:$id",
            "threadId" to c.stringOrEmpty(threadIdx),
            "address" to address,
            "body" to body,
            "dateMs" to dateMs.toDouble(),
            "type" to mmsType(box),
            "read" to (!c.isNull(readIdx) && c.getInt(readIdx) != 0),
            "kind" to "mms"
          )
        )
      }
    }
    return out
  }

  private fun mmsType(box: Int): String = when (box) {
    MMS_BOX_INBOX -> "inbox"
    MMS_BOX_SENT -> "sent"
    MMS_BOX_DRAFTS -> "draft"
    MMS_BOX_OUTBOX -> "outbox"
    MMS_BOX_FAILED -> "failed"
    else -> "other"
  }

  /** Concatenates all text/plain parts of an MMS. */
  private fun mmsText(mmsId: Long): String {
    val parts = ArrayList<String>()
    try {
      resolver.query(
        MMS_PART_URI,
        arrayOf("_id", "ct", "text", "_data"),
        "mid = ? AND ct = ?",
        arrayOf(mmsId.toString(), "text/plain"),
        "_id ASC"
      )?.use { c ->
        val idIdx = c.getColumnIndexOrThrow("_id")
        val textIdx = c.getColumnIndexOrThrow("text")
        val dataIdx = c.getColumnIndex("_data")
        while (c.moveToNext()) {
          val inline = if (c.isNull(textIdx)) null else c.getString(textIdx)
          val text = if (!inline.isNullOrEmpty()) {
            inline
          } else if (dataIdx >= 0 && !c.isNull(dataIdx)) {
            readPartStream(c.getLong(idIdx))
          } else {
            null
          }
          if (!text.isNullOrEmpty()) parts.add(text)
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to read MMS parts for $mmsId", e)
    }
    return parts.joinToString("\n")
  }

  private fun readPartStream(partId: Long): String? = try {
    resolver.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { stream ->
      stream.readBytes().toString(Charsets.UTF_8)
    }
  } catch (e: Throwable) {
    null
  }

  /**
   * Inbox: the FROM (137) address. Sent/other: the TO (151) addresses, falling back to FROM.
   */
  private fun mmsAddress(mmsId: Long, box: Int): String {
    val from = ArrayList<String>()
    val to = ArrayList<String>()
    try {
      resolver.query(
        Uri.parse("content://mms/$mmsId/addr"),
        arrayOf("address", "type"),
        null,
        null,
        null
      )?.use { c ->
        val addrIdx = c.getColumnIndexOrThrow("address")
        val typeIdx = c.getColumnIndexOrThrow("type")
        while (c.moveToNext()) {
          val address = if (c.isNull(addrIdx)) null else c.getString(addrIdx)
          if (address.isNullOrBlank() || address == "insert-address-token") continue
          when (if (c.isNull(typeIdx)) -1 else c.getInt(typeIdx)) {
            MMS_ADDR_FROM -> from.add(address)
            MMS_ADDR_TO -> to.add(address)
          }
        }
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Failed to read MMS address for $mmsId", e)
    }
    return if (box == MMS_BOX_INBOX || to.isEmpty()) {
      from.firstOrNull() ?: to.joinToString(", ")
    } else {
      to.joinToString(", ")
    }
  }

  // endregion
}

internal fun Cursor.stringOrEmpty(index: Int): String = if (isNull(index)) "" else getString(index) ?: ""
