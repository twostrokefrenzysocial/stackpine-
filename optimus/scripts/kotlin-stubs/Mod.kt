// Compile-only stubs used by scripts/check-android-kotlin.sh.
package expo.modules.kotlin.modules
import android.content.Context
class AppContext { val reactContext: Context? = null }
class ModuleDefinitionData
abstract class Module {
  val appContext: AppContext = AppContext()
  abstract fun definition(): ModuleDefinitionData
}
class ModuleDefinitionBuilder {
  fun Name(name: String) {}
  @JvmName("FunctionWithoutArgs") inline fun Function(name: String, crossinline body: () -> Any?) {}
  inline fun <reified R> Function(name: String, crossinline body: () -> R) {}
  inline fun <reified R, reified P0> Function(name: String, crossinline body: (p0: P0) -> R) {}
  inline fun <reified R, reified P0, reified P1> Function(name: String, crossinline body: (p0: P0, p1: P1) -> R) {}
  @JvmName("AsyncFunctionWithoutArgs") inline fun AsyncFunction(name: String, crossinline body: () -> Any?) {}
  inline fun <reified R> AsyncFunction(name: String, crossinline body: () -> R) {}
  inline fun <reified R, reified P0> AsyncFunction(name: String, crossinline body: (p0: P0) -> R) {}
  inline fun <reified R, reified P0, reified P1> AsyncFunction(name: String, crossinline body: (p0: P0, p1: P1) -> R) {}
}
inline fun Module.ModuleDefinition(crossinline block: ModuleDefinitionBuilder.() -> Unit): ModuleDefinitionData = ModuleDefinitionData()
