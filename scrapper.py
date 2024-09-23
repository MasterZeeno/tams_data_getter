import os
import json
import requests
import sys
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException, ElementClickInterceptedException
from urllib.parse import urljoin
from datetime import datetime
import time

# Load environment variables from .env file
load_dotenv()

# Setup the Chrome options
options = webdriver.ChromeOptions()
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--display=:1")
# Uncomment the next line for headless mode
options.add_argument("--headless")
options.add_argument("--disable-gpu")  # Disable GPU acceleration
options.add_argument("--window-size=1920x1080")  # Set a window size

DRIVER_PATH = os.getenv("CHROME_DRIVER_PATH", "/usr/bin/chromedriver")

service = Service(DRIVER_PATH)

try:
    driver = webdriver.Chrome(service=service, options=options)
except Exception as e:
    print(f"Error initializing Chrome WebDriver: {e}")
    sys.exit(1)

nav_url = os.getenv("TAMS_BASE_URL")
if not nav_url:
    print("Base URL is not set. Please set the 'TAMS_BASE_URL' in your .env file.")
    driver.quit()
    sys.exit(1)

global_timeout = 10  # Increased timeout for better reliability

def print_success(message):
    print(f"\033[92m  ✔ {message}\033[0m")  # Green text

def print_error(message):
    print(f"\033[91m  ✖ {message}\033[0m")  # Red text

def print_warning(message):
    print(f"\033[93m{message}\033[0m")  # Yellow (close to orange) text

def check_internet(url=nav_url, timeout=global_timeout, retries=3):
    for attempt in range(1, retries + 1):
        try:
            response = requests.get(url, timeout=timeout)
            if response.status_code == 200:
                print_success("Internet connection verified.")
                return True
            else:
                print_error(f"Received unexpected status code: {response.status_code}")
        except requests.ConnectionError as e:
            print_error(f"Attempt {attempt}/{retries} failed: Connection error: {e}")
        except requests.Timeout:
            print_error(f"Attempt {attempt}/{retries} failed: Request timed out.")
        
        if attempt < retries:
            print_warning("Retrying in 1 second...")
            time.sleep(1)
    print_error("Failed to establish internet connection after multiple attempts.")
    sys.exit(1)

def navigate(url):
    if any(keyword in url.lower() for keyword in ["overtime", "officialbusiness", "leave"]):
        full_url = urljoin(nav_url, f"filing/{url}")
    else:
        full_url = urljoin(nav_url, url)
    
    try:
        driver.get(full_url)
    except Exception as e:
        print_error(f"Error navigating to {full_url}: {e}")
        sys.exit(1)

def validate_and_create_path(path=None):
    path = path or os.path.join(os.environ.get('PWD', ''), 'src/assets')
    try:
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        print_error(f"Error creating directory '{path}': {e}")
        driver.quit()
        sys.exit(1)
    return path

def scrape_table_data(url):
    table_data = []
    table = process_element(by=By.TAG_NAME, locator="table")
    if not table:
        print_error("Table not found.")
        return table_data
    
    header = process_element(table, by=By.TAG_NAME, locator="thead")
    if not header:
        print_error("Table header not found.")
        return table_data
    
    header_elems = process_element(header, by=By.TAG_NAME, locator="th", multiple=True)
    if not header_elems:
        print_error("Table headers not found.")
        return table_data
    
    headers = [header.text.strip().replace('\n', ' ').replace(' ', '_').lower() for header in header_elems]
    
    tbody = process_element(table, by=By.TAG_NAME, locator="tbody")
    if not tbody:
        print_error("Table body not found.")
        return table_data
    
    rows = process_element(tbody, by=By.TAG_NAME, locator="tr", multiple=True)
    if not rows:
        return table_data
    
    for row in rows:
        cells = process_element(row, by=By.TAG_NAME, locator="td", multiple=True)
        if not cells:
            continue
        row_data = {
            header: cell.text.strip() 
            for header, cell in zip(headers, cells)
            if "action" not in header and "attachment" not in header
        }
        table_data.append(row_data)
    
    return table_data

def process_element(parent=None, by=By.ID, locator=None, multiple=False, timeout=global_timeout):
    if locator is None:
        print_error("Locator must be provided.")
        return None
        
    if parent is None:
        parent = driver
        
    try:
        if multiple:
            elements = WebDriverWait(parent, timeout).until(
                EC.presence_of_all_elements_located((by, locator))
            )
            return elements
        else:
            element = WebDriverWait(parent, timeout).until(
                EC.presence_of_element_located((by, locator))
            )
            return element
    except TimeoutException:
        return None
    except NoSuchElementException:
        print_warning(f"Element not found: {locator} by {by}")
        return None
    except Exception as e:
        print_error(f"Error processing element '{locator}' by {by}: {e}")
        return None

def login():
    try:
        # Assuming login-form is identified by ID; adjust as needed
        login_form = process_element(by=By.ID, locator="login-form")
        if not login_form:
            print_error("Login form not found.")
            driver.quit()
            sys.exit(1)
        
        values = ["username", "password"]
        
        for value in values:
            input_value = os.getenv(value.upper())
            if not input_value:
                print_error(f"Environment variable '{value.upper()}' not set.")
                driver.quit()
                sys.exit(1)
            el = process_element(login_form, by=By.NAME, locator=value)
            if not el:
                print_error(f"Login input '{value}' not found.")
                driver.quit()
                sys.exit(1)
            el.clear()
            el.send_keys(input_value)

        # Submit the form; assuming there's a submit button
        submit_button = process_element(login_form, by=By.XPATH, locator=".//button[@type='submit']")
        if submit_button:
            try:
                submit_button.click()
            except ElementClickInterceptedException:
                login_form.submit()
        else:
            login_form.submit()
        
        # Wait for login success, e.g., presence of employee_id element
        login_success = process_element(by=By.ID, locator="employee_id")
        if login_success:
            print_success("Login successful!")
        else:
            print_error("Login failed: 'employee_id' element not found.")
            driver.quit()
            sys.exit(1)
    
    except Exception as e:
        print_error(f"Failed to login: {e}")
        driver.quit()
        sys.exit(1)

def main():
    try:
        if not check_internet():
            print_error("No internet connection. Please check your connection and try again.")
            driver.quit()
            sys.exit(1)
        
        navigate("Auth")
        login()
    
        url_list = ["attendance", "overtime", "officialbusiness", "leave"]
        main_table_data = {}
        
        for url in url_list:
            navigate(url)
            table_data = []
            
            if "attendance" in url.lower(): 
                months = ["January", "February", "March", "April", "May", "June",
                          "July", "August", "September", "October", "November", "December"]
                current_month = datetime.now().month
                current_year = datetime.now().year
                    
                for increment in range(-1, 2):  # -1, 0, 1 for previous, current, and next month
                    month_select = process_element(by=By.ID, locator="month")  
                    year_input = process_element(by=By.NAME, locator="year")
                    
                    if month_select is not None and year_input is not None:
                        adjusted_month = (current_month + increment - 1) % 12 + 1
                        adjusted_year = current_year
                        
                        # Adjust the year if the month rolls over
                        if adjusted_month == 12 and increment == -1:
                            adjusted_year -= 1  # Previous December -> Decrement year
                        elif adjusted_month == 1 and increment == 1:
                            adjusted_year += 1  # Next January -> Increment year
                            
                        selected_month = months[adjusted_month - 1]

                        # Select the month
                        try:
                            month_select.click()
                        except Exception as e:
                            print_error(f"Error clicking month selector: {e}")
                            continue
                        
                        # Corrected XPath by adding the missing closing parenthesis
                        month_option = process_element(
                            parent=month_select, 
                            by=By.XPATH,
                            locator=f".//option[contains(text(), '{selected_month}')]"
                        )
                        if month_option is not None:
                            try:
                                month_option.click()
                            except Exception as e:
                                print_error(f"Error selecting month '{selected_month}': {e}")
                                continue
                        else:
                            print_warning(f"Month option '{selected_month}' not found.")
                            continue
    
                        # Set the year; using send_keys instead of setting value directly
                        try:
                            year_input.clear()
                            year_input.send_keys(str(adjusted_year))
                        except Exception as e:
                            print_warning(f"Error setting year '{adjusted_year}': {e}")
                            continue
                            
                        # Click the search button
                        search_btn = process_element(by=By.XPATH, locator="//button[@type='submit' and contains(text(), 'Search')]")
                        if search_btn is not None:
                            try:
                                search_btn.click()
                                # Optionally, wait for the table to reload
                                time.sleep(2)  # Adjust as needed or use explicit waits
                            except Exception as e:
                                print_warning(f"Error clicking search button: {e}")
                                continue
                        else:
                            print_warning("Search button not found.")
                            continue
                        
                        # Scrape table data for the selected month and year
                        scraped_data = scrape_table_data(url)
                        if scraped_data:
                            table_data.append(scraped_data)
                    else:
                        print_error("Month selector or year input not found.")
            else:
                scraped_data = scrape_table_data(url)
                if scraped_data:
                    table_data.append(scraped_data)
            
            if table_data:
                flattened = [item for data in table_data for item in data]
                main_table_data[url] = flattened
                print_success(f"Sucessfully scrapped {url.title()} table.")
                
        if main_table_data:
            assets_path = validate_and_create_path()
            json_path = os.path.join(assets_path, 'data.json')
        
            try:
                with open(json_path, 'w') as json_file:
                    json.dump(main_table_data, json_file, indent=2)
                    
                relative_path = os.path.relpath(json_path, os.getcwd())
                print_success(f"Success! Data saved to: {relative_path}")
            except OSError as os_err:
                print_error(f"Error saving data to file: {os_err}")
        else:
            print_error("No data collected from any of the URLs.")
    
    finally:
        driver.quit()

if __name__ == "__main__":
    main()