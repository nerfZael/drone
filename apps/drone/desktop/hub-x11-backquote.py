"""Reserve the physical TLDE key while Electron's desktop session is alive.

The host's uiohook listener dispatches presses. This connection only owns the
X11 grabs, preventing those presses from reaching the focused application.
"""
import ctypes as C
import ctypes.util
import json
import select
import sys


def main():
    x = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
    signatures = {
        'XOpenDisplay': (C.c_void_p, [C.c_char_p]),
        'XDefaultRootWindow': (C.c_ulong, [C.c_void_p]),
        'XConnectionNumber': (C.c_int, [C.c_void_p]),
        'XGrabKey': (C.c_int, [C.c_void_p, C.c_int, C.c_uint, C.c_ulong, C.c_int, C.c_int, C.c_int]),
        'XUngrabKey': (C.c_int, [C.c_void_p, C.c_int, C.c_uint, C.c_ulong]),
        'XSync': (C.c_int, [C.c_void_p, C.c_int]),
        'XPending': (C.c_int, [C.c_void_p]),
        'XNextEvent': (C.c_int, [C.c_void_p, C.c_void_p]),
        'XCloseDisplay': (C.c_int, [C.c_void_p]),
        'XKeysymToKeycode': (C.c_ubyte, [C.c_void_p, C.c_ulong]),
        'XFreeModifiermap': (C.c_int, [C.c_void_p]),
    }
    for name, (restype, argtypes) in signatures.items():
        fn = getattr(x, name)
        fn.restype, fn.argtypes = restype, argtypes

    class ModifierMap(C.Structure):
        _fields_ = [('max_keypermod', C.c_int), ('modifiermap', C.POINTER(C.c_ubyte))]

    x.XGetModifierMapping.restype = C.POINTER(ModifierMap)
    x.XGetModifierMapping.argtypes = [C.c_void_p]
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('Cannot connect to the X11 display.')
    # Both the evdev and xfree86 tables used by libuiohook map Backquote to 49.
    keycode = 49
    root = x.XDefaultRootWindow(display)
    errors = []
    handler_type = C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)
    handler = handler_type(lambda *_: errors.append(True) or 0)
    x.XSetErrorHandler.argtypes = [handler_type]
    x.XSetErrorHandler(handler)
    try:
        locks = [2]  # Caps Lock
        mapping = x.XGetModifierMapping(display)
        if not mapping:
            raise RuntimeError('Cannot read X11 modifier mapping.')
        try:
            for keysym in [0xff7f, 0xff14]:  # Num Lock, Scroll Lock
                code = x.XKeysymToKeycode(display, keysym)
                for index in range(8 * mapping.contents.max_keypermod):
                    if code and mapping.contents.modifiermap[index] == code:
                        locks.append(1 << (index // mapping.contents.max_keypermod))
        finally:
            x.XFreeModifiermap(mapping)
        lock_masks = {0}
        for lock in locks:
            lock_masks |= {mask | lock for mask in list(lock_masks)}
        config = json.loads(sys.stdin.readline())
        actions = {}
        seen = set()
        bindings = config['bindings']
        masks = {action: ((4 if b.get('mod') or b.get('ctrl') else 0)
                          | (64 if b.get('meta') and not b.get('mod') else 0)
                          | (8 if b.get('alt') else 0) | (1 if b.get('shift') else 0))
                 for action, b in bindings.items()}
        for action, mask in masks.items():
            variants = {mask | lock for lock in lock_masks}
            error = ''
            if list(masks.values()).count(mask) > 1 or variants & seen:
                error = 'Another global Drone Hub action uses this shortcut.'
            else:
                errors.clear()
                for modifiers in variants:
                    x.XGrabKey(display, keycode, modifiers, root, False, 1, 1)
                x.XSync(display, False)
                if errors:
                    error = 'This physical key is reserved by another application.'
                    for modifiers in variants:
                        x.XUngrabKey(display, keycode, modifiers, root)
                else:
                    seen |= variants
            actions[action] = {'active': not error, 'error': error}
        if config.get('suspended'):
            x.XUngrabKey(display, keycode, 1 << 15, root)  # AnyModifier
        x.XSync(display, False)
        print(json.dumps(actions), flush=True)
        event = (C.c_long * 24)()  # XEvent union
        while True:
            while x.XPending(display):
                x.XNextEvent(display, C.byref(event))
            readable, _, _ = select.select([sys.stdin, x.XConnectionNumber(display)], [], [])
            if sys.stdin in readable:
                # EOF or a close command releases every grab on this connection.
                break
    finally:
        x.XCloseDisplay(display)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
