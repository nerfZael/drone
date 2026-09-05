export const MESH_MAX_MESSAGE_BYTES = 256 * 1024;

// Leave room for signatures, routing fields, and response envelopes.
export const MESH_SAFE_MESSAGE_BYTES = 240 * 1024;

// Chat payloads sit inside a capability response envelope, so reserve more
// space than a normal request does.
export const MESH_CHAT_PAYLOAD_BYTES = 205 * 1024;
