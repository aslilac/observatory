// napi-build wires up the platform-specific link flags Node needs to load
// the cdylib as a native module (e.g. -undefined dynamic_lookup on macOS).
// It's a no-op when the `napi` feature is off, but invoking it
// unconditionally keeps the build script simple.
fn main() {
	napi_build::setup();
}
