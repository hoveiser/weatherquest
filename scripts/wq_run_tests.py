"""Run the direct-mode test suite on Windows.

The gltest direct loader (gltest/direct/loader.py::_inject_message_to_fd0)
unlinks its temp file in a finally block while fd 0 still references it via
os.dup2. On Linux the inode survives until close, but on Windows os.unlink
raises PermissionError for any path with an open handle, so every
method-invoking test crashes before the assertion runs. This shim defers the
unlink until the handle is released (after the VM restores stdin) and is
scoped to this runner only; CI and Linux are unaffected.
"""
import atexit
import os
import sys
import tempfile

if sys.platform == "win32":
    _orig_unlink = os.unlink
    _deferred = []

    def _shim_unlink(path, *a, **kw):
        try:
            return _orig_unlink(path, *a, **kw)
        except PermissionError:
            _deferred.append(path)

    os.unlink = _shim_unlink

    def _flush():
        for p in list(_deferred):
            try:
                _orig_unlink(p)
                _deferred.remove(p)
            except OSError:
                pass

    atexit.register(_flush)

import pytest

args = sys.argv[1:] or ["tests/direct/", "-q"]
sys.exit(pytest.main(args))
