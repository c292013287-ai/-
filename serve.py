#!/usr/bin/env python3
"""SPA 静态服务器 - 所有非文件请求回退到 index.html"""
import http.server
import os
import sys

DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'admin-frontend', 'dist')

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            self.path = '/index.html'
        super().do_GET()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    print(f'SPA Server running on http://localhost:{port}')
    http.server.HTTPServer(('0.0.0.0', port), SPAHandler).serve_forever()
