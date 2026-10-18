package expo.modules.optimusandroid

import android.content.ContentResolver
import android.provider.CallLog
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CallLogQueryOptions : Record {
  /** Only calls with date strictly greater than this (epoch ms). */
  @Field
  var sinceMs: Double? = null

  /** Default 200, clamped to 1..1000. */
  @Field
  var limit: Int? = null

  /**
   * Phone number filter. When it has 7+ digits, matches on the last 7 digits so that
   * "+1 (555) 123-4567", "5551234567" and "+15551234567" all match each other.
   */
  @Field
  var number: String? = null
}

class CallLogReader(private val resolver: ContentResolver) {
  fun read(opts: CallLogQueryOptions): List<Map<String, Any?>> {
    val limit = SmsReader.clampLimit(opts.limit)
    val selection = StringBuilder()
    val args = ArrayList<String>()
    fun addClause(clause: String) {
      if (selection.isNotEmpty()) selection.append(" AND ")
      selection.append(clause)
    }

    opts.sinceMs?.let {
      addClause("${CallLog.Calls.DATE} > ?")
      args.add(it.toLong().toString())
    }

    opts.number?.trim()?.takeIf { it.isNotEmpty() }?.let { raw ->
      val digits = raw.filter { it.isDigit() }
      val needle = if (digits.length >= 7) digits.takeLast(7) else raw
      addClause("${CallLog.Calls.NUMBER} LIKE ? ESCAPE '\\'")
      args.add("%${SmsReader.escapeLike(needle)}%")
    }

    val projection = arrayOf(
      CallLog.Calls._ID,
      CallLog.Calls.NUMBER,
      CallLog.Calls.CACHED_NAME,
      CallLog.Calls.DATE,
      CallLog.Calls.DURATION,
      CallLog.Calls.TYPE
    )

    val out = ArrayList<Map<String, Any?>>()
    resolver.query(
      CallLog.Calls.CONTENT_URI,
      projection,
      selection.toString().ifEmpty { null },
      if (args.isEmpty()) null else args.toTypedArray(),
      "${CallLog.Calls.DATE} DESC"
    )?.use { c ->
      val idIdx = c.getColumnIndexOrThrow(CallLog.Calls._ID)
      val numberIdx = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
      val nameIdx = c.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)
      val dateIdx = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
      val durationIdx = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
      val typeIdx = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
      while (c.moveToNext() && out.size < limit) {
        val cachedName = if (c.isNull(nameIdx)) null else c.getString(nameIdx)?.takeIf { it.isNotBlank() }
        out.add(
          mapOf(
            "id" to c.getLong(idIdx).toString(),
            "number" to c.stringOrEmpty(numberIdx),
            "cachedName" to cachedName,
            "dateMs" to c.getLong(dateIdx).toDouble(),
            "durationSec" to (if (c.isNull(durationIdx)) 0L else c.getLong(durationIdx)).toDouble(),
            "type" to callType(if (c.isNull(typeIdx)) -1 else c.getInt(typeIdx))
          )
        )
      }
    }
    return out
  }

  private fun callType(type: Int): String = when (type) {
    CallLog.Calls.INCOMING_TYPE -> "incoming"
    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
    CallLog.Calls.MISSED_TYPE -> "missed"
    CallLog.Calls.REJECTED_TYPE -> "rejected"
    CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
    CallLog.Calls.BLOCKED_TYPE -> "blocked"
    else -> "other"
  }
}
