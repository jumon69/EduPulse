import sys
import json
import re

def process_text(text):
    # This represents the "Python logic" the user requested.
    # It could perform advanced Bengali text cleaning or keyword extraction.
    
    # Simple cleaning for this example
    cleaned = re.sub(r'\s+', ' ', text).strip()
    
    # Return some "features" extracted for the material
    return {
        "word_count": len(cleaned.split()),
        "language": "bn" if any("\u0980" <= char <= "\u09FF" for char in cleaned) else "en",
        "processed_text": cleaned
    }

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        result = process_text(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
