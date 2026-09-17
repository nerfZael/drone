"""Read the current X11 root cursor position, including outside Hub windows."""
import ctypes as C
import ctypes.util
import json


def main():
    x = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
    signatures = {
        'XOpenDisplay': (C.c_void_p, [C.c_char_p]),
        'XDefaultRootWindow': (C.c_ulong, [C.c_void_p]),
        'XQueryPointer': (C.c_int, [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong),
                                  C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_int),
                                  C.POINTER(C.c_int), C.POINTER(C.c_uint)]),
        'XCloseDisplay': (C.c_int, [C.c_void_p]),
    }
    for name, (restype, argtypes) in signatures.items():
        fn = getattr(x, name)
        fn.restype, fn.argtypes = restype, argtypes
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('Cannot connect to the X11 display.')
    try:
        root, child = C.c_ulong(), C.c_ulong()
        root_x, root_y, win_x, win_y = C.c_int(), C.c_int(), C.c_int(), C.c_int()
        mask = C.c_uint()
        if not x.XQueryPointer(display, x.XDefaultRootWindow(display), C.byref(root), C.byref(child),
                               C.byref(root_x), C.byref(root_y), C.byref(win_x), C.byref(win_y), C.byref(mask)):
            raise RuntimeError('Cannot locate the cursor on the X11 root screen.')
        print(json.dumps({'x': root_x.value, 'y': root_y.value}))
    finally:
        x.XCloseDisplay(display)


if __name__ == '__main__':
    main()
