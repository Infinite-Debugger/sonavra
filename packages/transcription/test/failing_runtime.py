import json
import sys

print(json.dumps({"error": "model unavailable", "type": "RuntimeError"}), file=sys.stderr)
sys.exit(1)
