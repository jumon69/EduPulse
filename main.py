import sys
import json
import database

def clean_text(text):
    # Remove excessive symbols and control characters
    return " ".join(text.split())

def analyze_structure(text):
    words = text.split()
    word_count = len(words)
    
    # Simple language detection logic (Bengali vs English)
    # Most HSC content is mix, but we prioritize Bengali detection
    bengali_chars = any('\u0980' <= char <= '\u09FF' for char in text[:1000])
    lang = "bn" if bengali_chars else "en"
    
    # Logic to identify if it looks like a question paper
    is_mcq = text.lower().count("(a)") > 2 or text.lower().count("১.") > 2
    
    return {
        "word_count": word_count,
        "language": lang,
        "is_mcq_formatted": is_mcq,
        "processed_text": text # For now returning original, can be cleaned if needed
    }

if __name__ == "__main__":
    try:
        # Initialize Python DB
        database.init_db()
        
        # Read from stdin
        input_data = sys.stdin.read()
        
        if not input_data:
            print(json.dumps({"error": "No input provided"}))
            sys.exit(0)
            
        result = analyze_structure(input_data)
        
        # Log to Python DB
        database.log_request(len(input_data), result["word_count"])
        
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "word_count": 0,
            "language": "unknown",
            "processed_text": "Error in Python processing"
        }))
