use addr2line::{Context, Location}; // Removed FrameIter
use gimli::{DwLang, EndianRcSlice}; // Added DwLang here
use object::{File, Object, ObjectKind}; // Ensure File is imported
use std::{borrow::Cow, rc::Rc}; // Added Cow for type signatures
use wasm_bindgen::prelude::*;

// Optional: Better panic messages in the JS console
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
    web_sys::console::log_1(&"Wasm module initialized".into());
}

// Helper to convert errors to JsValue
fn to_js_error<E: std::fmt::Display>(err: E) -> JsValue {
    JsValue::from_str(&err.to_string())
}

#[wasm_bindgen]
pub struct Addr2LineProcessor {
    #[allow(dead_code)]
    file_data: Rc<Vec<u8>>,
    context: Context<EndianRcSlice<gimli::RunTimeEndian>>,
}

#[wasm_bindgen]
impl Addr2LineProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new(file_bytes: js_sys::Uint8Array) -> Result<Addr2LineProcessor, JsValue> {
        web_sys::console::log_1(&"Received file bytes in Wasm".into());

        let data_vec = file_bytes.to_vec();
        let file_data = Rc::new(data_vec);

        web_sys::console::log_1(&format!("Data size: {} bytes", file_data.len()).into());

        let obj_file = object::File::parse(&**file_data).map_err(to_js_error)?;

        web_sys::console::log_1(&format!("Parsed object file, kind: {:?}", obj_file.kind()).into());
        if obj_file.kind() == ObjectKind::Unknown {
             web_sys::console::warn_1(&"Warning: Object kind is Unknown. Debug info might be missing or in unexpected format.".into());
        }
         if !obj_file.has_debug_symbols() {
             web_sys::console::warn_1(&"Warning: Object file reports no debug symbols.".into());
        }

        let context = Context::new(&obj_file).map_err(to_js_error)?;

        web_sys::console::log_1(&"Created addr2line context".into());

        Ok(Addr2LineProcessor { file_data, context })
    }

    #[wasm_bindgen(js_name = lookupAddress)]
    pub fn lookup_address(&self, address: js_sys::BigInt) -> Result<Option<String>, JsValue> {
        let addr_u64 = address
            .try_into()
            .map_err(|e| to_js_error(format!("Failed to convert BigInt address: {}", e)))?;

        web_sys::console::log_1(&format!("Looking up address: {:#x}", addr_u64).into());

        match self.context.find_location(addr_u64) {
            Ok(Some(Location { file, line, column })) => {
                let file_str = file.unwrap_or("<unknown file>");
                let loc_str = match (line, column) {
                    (Some(l), Some(c)) => format!("{}:{}:{}", file_str, l, c),
                    (Some(l), None) => format!("{}:{}", file_str, l),
                    _ => file_str.to_string(),
                };
                web_sys::console::log_1(&format!("Found location: {}", loc_str).into());
                Ok(Some(loc_str))
            }
            Ok(None) => {
                 web_sys::console::log_1(&"Address not found in debug symbols.".into());
                 Ok(None)
            }
            Err(e) => {
                web_sys::console::error_1(&format!("addr2line error: {}", e).into());
                Err(to_js_error(e))
            }
        }
    }

    #[wasm_bindgen(js_name = lookupFrames)]
    pub fn lookup_frames(&self, address: js_sys::BigInt) -> Result<js_sys::Array, JsValue> {
        let addr_u64 = address
            .try_into()
            .map_err(|e| to_js_error(format!("Failed to convert BigInt address: {}", e)))?;

        web_sys::console::log_1(&format!("Looking up frames for address: {:#x}", addr_u64).into());

        let frames_result = self.context.find_frames(addr_u64).skip_all_loads();
        let mut frames_iter = frames_result.map_err(to_js_error)?;

        let js_frames = js_sys::Array::new();

        while let Ok(Some(frame)) = frames_iter.next() {
             // *** REVISED FUNCTION NAME LOGIC ***
             let func_name = match frame.function.as_ref() {
                 Some(function_name) => {
                     match function_name.raw_name() { // Handle Result from raw_name()
                         Ok(raw_name_cow) => {
                             match function_name.language { // Handle Option from language()
                                 Some(lang) => {
                                     // Attempt demangle only if lang is Some
                                     addr2line::demangle(&raw_name_cow, lang)
                                         .unwrap_or_else(|| raw_name_cow.into_owned()) // Fallback to raw name
                                 }
                                 None => {
                                     // No language, use raw name
                                     raw_name_cow.into_owned()
                                 }
                             }
                         }
                         Err(_) => {
                             // Failed to read raw name
                             "<invalid function name>".to_string()
                         }
                     }
                 }
                 None => {
                     // No function info in frame
                     "<unknown function>".to_string()
                 }
             };

             let loc_str = match frame.location {
                 Some(Location { file, line, column }) => {
                    let file_str = file.unwrap_or("<unknown file>");
                     match (line, column) {
                        (Some(l), Some(c)) => format!("{}:{}:{}", file_str, l, c),
                        (Some(l), None) => format!("{}:{}", file_str, l),
                        _ => file_str.to_string(),
                    }
                }
                None => "<unknown location>".to_string(),
            };

             let frame_info = format!("Function: {}, Location: {}", func_name, loc_str);
             js_frames.push(&JsValue::from_str(&frame_info));
        }
         web_sys::console::log_1(&format!("Found {} frames", js_frames.length()).into());
        Ok(js_frames)
    }
}