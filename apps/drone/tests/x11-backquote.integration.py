"""Run with: python3 tests/x11-backquote.integration.py /path/to/Xvfb.

Uses a private X server so injected keys never touch the user's desktop.
"""
import ctypes as C
import ctypes.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import unittest


class PhysicalBackquoteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        read_fd, write_fd = os.pipe()
        cls.server = subprocess.Popen(
            [sys.argv[1], '-displayfd', str(write_fd), '-screen', '0', '640x480x24', '-nolisten', 'tcp'],
            pass_fds=[write_fd], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        cls.addClassCleanup(cls.stop_server)
        os.close(write_fd)
        with os.fdopen(read_fd) as output:
            if not select.select([output], [], [], 5)[0]:
                raise RuntimeError('Xvfb did not start')
            cls.display_name = ':' + output.readline().strip()
        cls.x = C.CDLL(ctypes.util.find_library('X11'))
        cls.xt = C.CDLL(ctypes.util.find_library('Xtst'))
        signatures = {
            'XOpenDisplay': (C.c_void_p, [C.c_char_p]),
            'XDefaultRootWindow': (C.c_ulong, [C.c_void_p]),
            'XCreateSimpleWindow': (C.c_ulong, [C.c_void_p, C.c_ulong, C.c_int, C.c_int, C.c_uint, C.c_uint, C.c_uint, C.c_ulong, C.c_ulong]),
            'XSelectInput': (C.c_int, [C.c_void_p, C.c_ulong, C.c_long]),
            'XMapWindow': (C.c_int, [C.c_void_p, C.c_ulong]),
            'XSetInputFocus': (C.c_int, [C.c_void_p, C.c_ulong, C.c_int, C.c_ulong]),
            'XSync': (C.c_int, [C.c_void_p, C.c_int]),
            'XPending': (C.c_int, [C.c_void_p]),
            'XNextEvent': (C.c_int, [C.c_void_p, C.c_void_p]),
            'XConnectionNumber': (C.c_int, [C.c_void_p]),
            'XCloseDisplay': (C.c_int, [C.c_void_p]),
            'XkbLockModifiers': (C.c_int, [C.c_void_p, C.c_uint, C.c_uint, C.c_uint]),
        }
        for name, (restype, argtypes) in signatures.items():
            getattr(cls.x, name).restype = restype
            getattr(cls.x, name).argtypes = argtypes
        cls.xt.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        cls.display = cls.x.XOpenDisplay(cls.display_name.encode())
        if not cls.display:
            raise RuntimeError('Cannot open isolated display')
        root = cls.x.XDefaultRootWindow(cls.display)
        cls.window = cls.x.XCreateSimpleWindow(cls.display, root, 0, 0, 100, 100, 0, 0, 0)
        cls.x.XSelectInput(cls.display, cls.window, 3)  # KeyPress | KeyRelease
        cls.x.XMapWindow(cls.display, cls.window)
        cls.x.XSetInputFocus(cls.display, cls.window, 1, 0)
        cls.x.XSync(cls.display, False)

    @classmethod
    def tearDownClass(cls):
        cls.x.XCloseDisplay(cls.display)

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)
        cls.server.stderr.close()

    def reserve(self, bindings=None, suspended=False):
        helper = Path(__file__).resolve().parent.parent / 'desktop' / 'hub-x11-backquote.py'
        child = subprocess.Popen([sys.executable, '-u', str(helper)],
                                 env={**os.environ, 'DISPLAY': self.display_name},
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.close_helper, child)
        child.stdin.write(json.dumps({'bindings': bindings or {'toggleCompanion': {'key': '`'}}, 'suspended': suspended}) + '\n')
        child.stdin.flush()
        self.assertTrue(select.select([child.stdout], [], [], 5)[0], 'helper startup timeout')
        line = child.stdout.readline()
        if not line:
            self.fail(child.stderr.read())
        return child, json.loads(line)

    @staticmethod
    def close_helper(child):
        if not child.stdin.closed:
            child.stdin.close()
        child.wait(timeout=5)
        child.stdout.close()
        child.stderr.close()

    def received_key_events(self, keycode=49):
        event = (C.c_long * 24)()
        while self.x.XPending(self.display):
            self.x.XNextEvent(self.display, C.byref(event))
        self.xt.XTestFakeKeyEvent(self.display, keycode, True, 0)
        self.xt.XTestFakeKeyEvent(self.display, keycode, False, 0)
        self.x.XSync(self.display, False)
        select.select([self.x.XConnectionNumber(self.display)], [], [], 0.05)
        received = []
        while self.x.XPending(self.display):
            self.x.XNextEvent(self.display, C.byref(event))
            received.append(C.cast(event, C.POINTER(C.c_int))[0])
        return received

    def test_consumes_only_bound_key_and_releases_on_close(self):
        child, status = self.reserve()
        self.assertTrue(status['toggleCompanion']['active'])
        self.assertEqual(self.received_key_events(), [])
        self.assertEqual(self.received_key_events(24), [2, 3])  # Q still types
        self.close_helper(child)
        self.assertEqual(self.received_key_events(), [2, 3])

    def test_locks_and_shift(self):
        for shift in [False, True]:
            child, status = self.reserve({'toggleCompanion': {'key': '~' if shift else '`', 'shift': shift}})
            self.assertTrue(status['toggleCompanion']['active'])
            if shift:
                self.xt.XTestFakeKeyEvent(self.display, 50, True, 0)
            try:
                for locks in [0, 2, 16, 18]:
                    self.x.XkbLockModifiers(self.display, 0x100, 18, locks)
                    self.x.XSync(self.display, False)
                    self.assertEqual(self.received_key_events(), [])
            finally:
                self.x.XkbLockModifiers(self.display, 0x100, 18, 0)
                if shift:
                    self.xt.XTestFakeKeyEvent(self.display, 50, False, 0)
                self.x.XSync(self.display, False)
                self.close_helper(child)

    def test_conflict_does_not_steal_existing_grab(self):
        _, first = self.reserve()
        _, second = self.reserve()
        self.assertTrue(first['toggleCompanion']['active'])
        self.assertFalse(second['toggleCompanion']['active'])
        self.assertEqual(self.received_key_events(), [])

    def test_capture_suspension_allows_typing(self):
        _, status = self.reserve(suspended=True)
        self.assertTrue(status['toggleCompanion']['active'])
        self.assertEqual(self.received_key_events(), [2, 3])

    def test_duplicate_physical_aliases_are_inactive(self):
        _, status = self.reserve({'first': {'key': '`'}, 'second': {'key': '~'}})
        self.assertTrue(all(not action['active'] for action in status.values()))
        self.assertEqual(self.received_key_events(), [2, 3])


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]], verbosity=2)
