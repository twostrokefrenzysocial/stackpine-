// Compile-only stubs used by scripts/check-android-kotlin.sh.
package androidx.core.content
import android.content.Context
object ContextCompat { @JvmStatic fun checkSelfPermission(context: Context, permission: String): Int = 0 }
