// Compile-only stubs used by scripts/check-android-kotlin.sh.
package expo.modules.kotlin.exception
open class CodedException(message: String?, cause: Throwable? = null) : Exception(message, cause) {
  constructor(code: String?, message: String?, cause: Throwable?) : this(message = message, cause = cause)
}
object Exceptions {
  class ReactContextLost : CodedException(message = "The react context has been lost")
}
