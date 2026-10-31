import json
import urllib.parse
import time
import requests
import urllib3

# Suppress SSL warnings due to verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def fetch_luhmann_bibliography(output_filename="luhmann_bibliography_zk2.json"):
    base_url = "https://v0.api.niklas-luhmann-archiv.de/ZK/search"
    all_results = []
    page = 1
    rows_per_page = 250  # Lowered chunk size to ensure stable payload execution
    
    print("Starting data extraction from the Niklas Luhmann Archiv API...")
    
    while True:
        # Utilizing systematic card ID prefixes (ZK_2_NB denotes ZK II literature box)
        query_payload = {
            "page": page,
            "rows": rows_per_page,
            "fulltext": "",
            "fuzzy": False,
            "FTSearchMode": "and",
            "zettelnummer": "ZK_2_NB",
            "zettelnummerSearchMode": "starts-with",
            "areas": [],
            "ref": "",
            "zks": ["2"]
        }
        
        # Minify and safely wrap string
        json_string = json.dumps(query_payload, separators=(',', ':'))
        encoded_query = urllib.parse.urlencode({"q": json_string})
        target_url = f"{base_url}?{encoded_query}"
        
        print(f"Fetching Page {page}...", end="\r")
        
        try:
            # Emulate browser agent to prevent automated block triggers
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            
            response = requests.get(target_url, timeout=30, verify=False, headers=headers)
            response.raise_for_status()
            
            # Defensive check: if the response body is blank or plain text
            if not response.text.strip():
                print(f"\n[Warning] Received empty response body on page {page}.")
                break
                
            try:
                data = response.json()
            except ValueError as json_err:
                print(f"\n\n[JSON Parse Error] Server did not return JSON on page {page}.")
                print("--- FIRST 500 CHARACTERS OF SERVER RESPONSE ---")
                print(response.text[:500])
                print("-----------------------------------------------")
                break
            
            results_chunk = data.get("results", data.get("docs", []))
            
            if not results_chunk:
                print(f"\nNo more records found. Total records fetched: {len(all_results)}")
                break
                
            all_results.extend(results_chunk)
            page += 1
            
            time.sleep(1.0) # Increased delay to minimize university proxy throttling
            
        except requests.exceptions.RequestException as e:
            print(f"\n[Network Error] Connection failed on page {page}: {e}")
            break
            
    if all_results:
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(all_results, f, ensure_ascii=False, indent=2)
        print(f"Success! Data written safely to {output_filename}")
    else:
        print("Extraction failed. No files were written.")

if __name__ == "__main__":
    fetch_luhmann_bibliography()

