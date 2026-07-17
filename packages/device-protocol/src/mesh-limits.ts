export const MESH_MAX_MESSAGE_BYTES = 256 * 1024;

// Leave room for signatures, routing fields, and response envelopes.
export const MESH_SAFE_MESSAGE_BYTES = 240 * 1024;

// Base64 expands binary data by roughly one third. A 128 KiB binary chunk stays
// comfortably below the safe JSON message budget after encoding and signing.
export const MESH_BINARY_CHUNK_BYTES = 128 * 1024;

// Chat payloads sit inside a capability response envelope, so reserve more
// space than a normal request does.
export const MESH_CHAT_PAYLOAD_BYTES = 205 * 1024;
