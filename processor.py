import sys
import json
import re

def process_text(text):
    # This represents the "Python logic" the user requested.
    # Advanced Bengali text cleaning and feature extraction.
    
    # Process text in chunks if very large to avoid regex memory spikes
    if len(text) > 5000000: # 5MB+
        # Simplified cleaning for huge texts
        cleaned = text.strip()
    else:
        cleaned = re.sub(r'\s+', ' ', text).strip()
    
    word_count = cleaned.count(' ') + 1
    
    # Efficient language detection for Bengali
    is_bengali = False
    # Only check first 10k chars for efficiency on huge files
    check_sample = cleaned[:10000]
    if any("\u0980" <= char <= "\u09FF" for char in check_sample):
        is_bengali = True
        
    return {
        "word_count": word_count,
        "language": "bn" if is_bengali else "en",
        "processed_text": cleaned if len(cleaned) < 10000000 else cleaned[:10000000] + "... (truncated for memory)"
    }

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        result = process_text(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
