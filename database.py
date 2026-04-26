import json
import sqlite3
import os

DB_PATH = "python_analytics.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS processing_logs 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                  text_length INTEGER, 
                  word_count INTEGER,
                  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()

def log_request(text_len, word_count):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("INSERT INTO processing_logs (text_length, word_count) VALUES (?, ?)", 
                  (text_len, word_count))
        conn.commit()
        conn.close()
    except Exception as e:
        pass # Non-critical failure
