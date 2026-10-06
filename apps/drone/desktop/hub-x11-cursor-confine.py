"""Confine the real cursor to a screen rectangle with XFixes pointer barriers.

Barriers are walls the cursor cannot cross. Unlike a pointer grab they take no events away from other
applications, so the Hub window keeps receiving the mouse as usual, at the user's own speed and acceleration.

Reads one JSON command per line on stdin and answers each with one JSON line:
  {"confine": {"x": 0, "y": 0, "width": 800, "height": 600}}  replaces any walls with walls around it
  {"release": true}                                           removes the walls
End of input closes the X11 connection, and the server removes every wall this connection made, so the cursor
is freed even if the desktop app stops without releasing it.
"""
import ctypes as C
import ctypes.util
import json
import sys

# The directions a barrier lets the cursor through, from <X11/extensions/Xfixes.h>.
BARRIER_POSITIVE_X = 1 << 0
BARRIER_POSITIVE_Y = 1 << 1
BARRIER_NEGATIVE_X = 1 << 2
BARRIER_NEGATIVE_Y = 1 << 3


def main():
    x = C.CDLL(ctypes.util.find_library('X11') or 'libX11.so.6')
    xfixes = C.CDLL(ctypes.util.find_library('Xfixes') or 'libXfixes.so.3')
    for lib, name, restype, argtypes in [
        (x, 'XOpenDisplay', C.c_void_p, [C.c_char_p]),
        (x, 'XDefaultRootWindow', C.c_ulong, [C.c_void_p]),
        (x, 'XSync', C.c_int, [C.c_void_p, C.c_int]),
        (x, 'XQueryPointer', C.c_int, [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong),
                                       C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_int),
                                       C.POINTER(C.c_int), C.POINTER(C.c_uint)]),
        (x, 'XWarpPointer', C.c_int, [C.c_void_p, C.c_ulong, C.c_ulong, C.c_int, C.c_int, C.c_uint, C.c_uint,
                                      C.c_int, C.c_int]),
        (x, 'XCloseDisplay', C.c_int, [C.c_void_p]),
        (xfixes, 'XFixesQueryExtension', C.c_int, [C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int)]),
        (xfixes, 'XFixesQueryVersion', C.c_int, [C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int)]),
        (xfixes, 'XFixesCreatePointerBarrier', C.c_ulong,
         [C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_int, C.c_void_p]),
        (xfixes, 'XFixesDestroyPointerBarrier', None, [C.c_void_p, C.c_ulong]),
    ]:
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = restype, argtypes

    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError('Cannot connect to the X11 display.')
    errors = []
    handler_type = C.CFUNCTYPE(C.c_int, C.c_void_p, C.c_void_p)
    handler = handler_type(lambda *_: errors.append(True) or 0)
    x.XSetErrorHandler.argtypes = [handler_type]
    x.XSetErrorHandler(handler)
    try:
        event_base, error_base, major, minor = C.c_int(), C.c_int(), C.c_int(5), C.c_int(0)
        if not xfixes.XFixesQueryExtension(display, C.byref(event_base), C.byref(error_base)):
            raise RuntimeError('The X server has no XFixes extension.')
        # Barriers came with XFixes 5; the version must also be asked for before they can be used.
        xfixes.XFixesQueryVersion(display, C.byref(major), C.byref(minor))
        if major.value < 5:
            raise RuntimeError('The X server has no pointer barriers (XFixes %d.%d).' % (major.value, minor.value))
        root = x.XDefaultRootWindow(display)
        barriers = []

        def destroy(walls):
            for barrier in walls:
                xfixes.XFixesDestroyPointerBarrier(display, barrier)

        def release():
            destroy(barriers)
            barriers.clear()
            x.XSync(display, False)

        def pointer():
            root_ret, child = C.c_ulong(), C.c_ulong()
            root_x, root_y, win_x, win_y, mask = C.c_int(), C.c_int(), C.c_int(), C.c_int(), C.c_uint()
            x.XQueryPointer(display, root, C.byref(root_ret), C.byref(child), C.byref(root_x), C.byref(root_y),
                            C.byref(win_x), C.byref(win_y), C.byref(mask))
            return root_x.value, root_y.value

        def confine(rect):
            left, top = int(rect['x']), int(rect['y'])
            right, bottom = left + int(rect['width']), top + int(rect['height'])
            if right - left < 2 or bottom - top < 2:
                raise ValueError('The area is too small to hold the cursor.')
            errors.clear()
            # The new walls go up before the old ones come down, so that while they move (a menu opened
            # outside the canvas, the canvas resized) there is no moment without walls to slip through.
            previous = list(barriers)
            barriers.clear()
            # Each wall lets the cursor through only inwards, and runs a pixel past the corners so that a
            # diagonal push cannot slip out between two walls.
            for x1, y1, x2, y2, inward in [
                (left, top - 1, left, bottom + 1, BARRIER_POSITIVE_X),
                (right, top - 1, right, bottom + 1, BARRIER_NEGATIVE_X),
                (left - 1, top, right + 1, top, BARRIER_POSITIVE_Y),
                (left - 1, bottom, right + 1, bottom, BARRIER_NEGATIVE_Y),
            ]:
                barriers.append(xfixes.XFixesCreatePointerBarrier(display, root, x1, y1, x2, y2, inward, 0, None))
            x.XSync(display, False)
            if errors:
                destroy(previous)
                release()
                raise RuntimeError('The X server refused the pointer barriers.')
            destroy(previous)
            # Walls keep the cursor out as well as in: one left outside a smaller box is brought back inside.
            px, py = pointer()
            inside_x = min(max(px, left), right - 1)
            inside_y = min(max(py, top), bottom - 1)
            if (inside_x, inside_y) != (px, py):
                x.XWarpPointer(display, 0, root, 0, 0, 0, 0, inside_x, inside_y)
            x.XSync(display, False)

        print(json.dumps({'ready': True}), flush=True)
        for line in sys.stdin:
            try:
                command = json.loads(line)
                if command.get('confine'):
                    confine(command['confine'])
                else:
                    release()
                print(json.dumps({'ok': True}), flush=True)
            except Exception as error:  # Answer and keep serving: one bad request must not end the helper.
                print(json.dumps({'ok': False, 'error': str(error)}), flush=True)
    finally:
        x.XCloseDisplay(display)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
