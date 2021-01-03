use neon::prelude::*;

fn hello(mut cx: FunctionContext) -> JsResult<JsString> {
    Ok(cx.string("hello node"))
}

#[allow(unused)]
struct Drive<'l> {
    mount_path: &'l str,
    description: &'l str,
}

register_module!(mut cx, { cx.export_function("hello", hello) });
