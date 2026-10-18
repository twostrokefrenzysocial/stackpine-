package expo.modules.optimusandroid

/**
 * Removes one-time passcodes from notification text before it is ever written to disk.
 *
 * Keep these rules in sync with the JS redactor (see README.md, "OTP redaction rules").
 *
 * 1. Always: Google-style codes such as "G-123456" are replaced.
 * 2. Only when a keyword (code, otp, verification, pin, ...) appears in title + text:
 *    a. standalone 4-8 digit runs, optionally split once by a space or dash
 *       ("1234", "123456", "123 456", "123-456") are replaced;
 *    b. standalone 6-8 character alphanumeric tokens with >= 2 digits and >= 1 letter
 *       ("AB12CD", "x7k9p2") are replaced.
 *
 * "Standalone" means not directly preceded or followed by an ASCII letter or digit.
 * Because the digit rules are keyword-gated, plain years ("2024") and amounts in
 * ordinary messages are left alone.
 */
object OtpRedactor {
  const val REPLACEMENT = "[code hidden]"

  /** Keywords that switch on the digit and alphanumeric rules (matched case-insensitively). */
  val KEYWORD_REGEX = Regex(
    "(?<![a-z0-9])(?:codes?|otp|passcodes?|verification|verify|one-time|one time|2fa|" +
      "two-factor|two factor|security code|login code|sign-in code|pins?|confirmation code|authentication)(?![a-z0-9])",
    RegexOption.IGNORE_CASE
  )

  /** Rule 1: Google-style "G-123456" (always on, case-sensitive "G"). */
  val GOOGLE_CODE_REGEX = Regex("(?<![A-Za-z0-9])G-\\d{4,8}(?![A-Za-z0-9])")

  /**
   * Rule 2a: a 4-8 digit run, or two 2-4 digit groups joined by one space or dash.
   * The split form is tried first so "123 456" becomes a single replacement.
   */
  val DIGIT_CODE_REGEX = Regex("(?<![A-Za-z0-9])(?:\\d{2,4}[ -]\\d{2,4}|\\d{4,8})(?![A-Za-z0-9])")

  /** Rule 2b: a 6-8 char alphanumeric token containing at least 2 digits and at least 1 letter. */
  val ALNUM_CODE_REGEX = Regex(
    "(?<![A-Za-z0-9])(?=(?:[A-Za-z]*[0-9]){2})(?=[0-9]*[A-Za-z])[A-Za-z0-9]{6,8}(?![A-Za-z0-9])"
  )

  data class Result(val title: String, val text: String, val redacted: Boolean)

  fun hasKeyword(title: String, text: String): Boolean =
    KEYWORD_REGEX.containsMatchIn("$title\n$text")

  fun redact(title: String, text: String): Result {
    val keyword = hasKeyword(title, text)
    var changed = false

    fun apply(input: String): String {
      var out = input
      val rules = if (keyword) {
        listOf(GOOGLE_CODE_REGEX, DIGIT_CODE_REGEX, ALNUM_CODE_REGEX)
      } else {
        listOf(GOOGLE_CODE_REGEX)
      }
      for (rule in rules) {
        if (rule.containsMatchIn(out)) {
          out = rule.replace(out, REPLACEMENT)
          changed = true
        }
      }
      return out
    }

    val newTitle = apply(title)
    val newText = apply(text)
    return Result(newTitle, newText, changed)
  }
}
