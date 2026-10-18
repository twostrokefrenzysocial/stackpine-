// Compile-only stubs mirroring the expo-modules-core / androidx signatures the module uses.
package expo.modules.kotlin.records
interface Record
@Target(AnnotationTarget.FIELD, AnnotationTarget.PROPERTY) annotation class Field(val key: String = "")
