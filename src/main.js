import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import axios from 'axios';
import dotenv from 'dotenv';
import { By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import process from 'process';

// Load environment variables from .env file
dotenv.config();

// Specify the path to the ChromeDriver
const driverPath = process.env.CHROME_DRIVER_PATH // || '/data/data/com.termux/files/usr/bin/chromedriver';

// Setup the Chrome options
const options = new chrome.Options();
options.addArguments('--no-sandbox');
options.addArguments('--disable-dev-shm-usage');
options.addArguments('--display=:1');
// Uncomment the next line for headless mode
options.addArguments('--headless');
// options.setChromeBinaryPath(driverPath);

let driver;

(async () => {
  try {
    const service = new chrome.ServiceBuilder(driverPath).build();
    driver = chrome.Driver.createSession(options, service);
  } catch (error) {
    console.error(`\x1b[91m  ✖ Error initializing Chrome WebDriver: ${error}\x1b[0m`); // Red text
    process.exit(1);
  }

  const nav_url = process.env.TAMS_BASE_URL;
  if (!nav_url) {
    console.error("\x1b[91m  ✖ Base URL is not set. Please set the 'TAMS_BASE_URL' in your .env file.\x1b[0m"); // Red text
    await driver.quit();
    process.exit(1);
  }

  const global_timeout = 10000; // 10 seconds in milliseconds

  // Utility functions for colored console output
  const printSuccess = (message) => {
    console.log(`\x1b[92m  ✔ ${message}\x1b[0m`); // Green text
  };

  const printError = (message) => {
    console.error(`\x1b[91m  ✖ ${message}\x1b[0m`); // Red text
  };

  const printWarning = (message) => {
    console.warn(`\x1b[93m${message}\x1b[0m`); // Yellow text
  };

  // Function to check internet connectivity
  const checkInternet = async (url = nav_url, timeout = global_timeout, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, { timeout });
        if (response.status === 200) {
          printSuccess('Internet connection verified.');
          return true;
        } else {
          printError(`Received unexpected status code: ${response.status}`);
        }
      } catch (error) {
        if (error.code === 'ECONNABORTED') {
          printError(`Attempt ${attempt}/${retries} failed: Request timed out.`);
        } else {
          printError(`Attempt ${attempt}/${retries} failed: Connection error: ${error.message}`);
        }
      }

      if (attempt < retries) {
        printWarning('Retrying in 1 second...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    printError('Failed to establish internet connection after multiple attempts.');
    await driver.quit();
    process.exit(1);
  };

  // Function to navigate to a specific URL
  const navigate = async (url) => {
    let full_url;
    if (["overtime", "officialbusiness", "leave"].some(keyword => url.toLowerCase().includes(keyword))) {
      full_url = new URL(`filing/${url}`, nav_url).href;
    } else {
      full_url = new URL(url, nav_url).href;
    }

    try {
      await driver.get(full_url);
    } catch (error) {
      printError(`Error navigating to ${full_url}: ${error.message}`);
      await driver.quit();
      process.exit(1);
    }
  };

  // Function to validate and create a directory path
  const validateAndCreatePath = (customPath = null) => {
    const targetPath = customPath || path.join(process.cwd(), 'src', 'assets');
    try {
      fs.mkdirSync(targetPath, { recursive: true });
    } catch (error) {
      printError(`Error creating directory '${targetPath}': ${error.message}`);
      driver.quit();
      process.exit(1);
    }
    return targetPath;
  };

  // Function to process elements (single or multiple)
  const processElement = async (parent = null, by = By.ID, locator = null, multiple = false, timeout = global_timeout) => {
    if (!locator) {
      printError('Locator must be provided.');
      return null;
    }

    const searchParent = parent || driver;

    try {
      if (multiple) {
        const elements = await driver.wait(
          until.elementsLocated(by, locator),
          timeout
        );
        return elements;
      } else {
        const element = await driver.wait(
          until.elementLocated(by, locator),
          timeout
        );
        return await searchParent.findElement(by, locator);
      }
    } catch (error) {
      if (error.name === 'TimeoutError') {
        return null;
      } else if (error.name === 'NoSuchElementError') {
        printWarning(`Element not found: ${locator} by ${by}`);
        return null;
      } else {
        printError(`Error processing element '${locator}' by ${by}: ${error.message}`);
        return null;
      }
    }
  };

  // Function to scrape table data
  const scrapeTableData = async (url) => {
    const tableData = [];
    const table = await processElement(null, By.TAG_NAME, 'table');

    if (!table) {
      printError('Table not found.');
      return tableData;
    }

    const header = await processElement(table, By.TAG_NAME, 'thead');
    if (!header) {
      printError('Table header not found.');
      return tableData;
    }

    const headerElems = await processElement(header, By.TAG_NAME, 'th', true);
    if (!headerElems) {
      printError('Table headers not found.');
      return tableData;
    }

    const headers = [];
    for (const headerElem of headerElems) {
      const text = await headerElem.getText();
      headers.push(text.trim().replace(/\n/g, ' ').replace(/ /g, '_').toLowerCase());
    }

    const tbody = await processElement(table, By.TAG_NAME, 'tbody');
    if (!tbody) {
      printError('Table body not found.');
      return tableData;
    }

    const rows = await processElement(tbody, By.TAG_NAME, 'tr', true);
    if (!rows) {
      return tableData;
    }

    for (const row of rows) {
      const cells = await processElement(row, By.TAG_NAME, 'td', true);
      if (!cells) continue;

      const rowData = {};
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        if (header.includes('action') || header.includes('attachment')) continue;

        const cell = cells[i];
        const cellText = cell ? (await cell.getText()).trim() : '';
        rowData[header] = cellText;
      }
      tableData.push(rowData);
    }

    return tableData;
  };

  // Function to perform login
  const login = async () => {
    try {
      // Assuming login-form is identified by ID; adjust as needed
      const loginForm = await processElement(null, By.ID, 'login-form');
      if (!loginForm) {
        printError('Login form not found.');
        await driver.quit();
        process.exit(1);
      }

      const values = ['username', 'password'];

      for (const value of values) {
        const inputValue = process.env[value.toUpperCase()];
        if (!inputValue) {
          printError(`Environment variable '${value.toUpperCase()}' not set.`);
          await driver.quit();
          process.exit(1);
        }

        const inputElement = await processElement(loginForm, By.NAME, value);
        if (!inputElement) {
          printError(`Login input '${value}' not found.`);
          await driver.quit();
          process.exit(1);
        }

        await inputElement.clear();
        await inputElement.sendKeys(inputValue);
      }

      // Submit the form; assuming there's a submit button
      const submitButton = await processElement(loginForm, By.XPATH, ".//button[@type='submit']");
      if (submitButton) {
        try {
          await submitButton.click();
        } catch (error) {
          await loginForm.submit();
        }
      } else {
        await loginForm.submit();
      }

      // Wait for login success, e.g., presence of employee_id element
      const loginSuccess = await processElement(null, By.ID, 'employee_id');
      if (loginSuccess) {
        printSuccess('Login successful!');
      } else {
        printError("Login failed: 'employee_id' element not found.");
        await driver.quit();
        process.exit(1);
      }
    } catch (error) {
      printError(`Failed to login: ${error.message}`);
      await driver.quit();
      process.exit(1);
    }
  };

  // Main function
  const main = async () => {
    try {
      if (!(await checkInternet())) {
        printError('No internet connection. Please check your connection and try again.');
        await driver.quit();
        process.exit(1);
      }

      await navigate('Auth');
      await login();

      const urlList = ['attendance', 'overtime', 'officialbusiness', 'leave'];
      const mainTableData = {};

      for (const url of urlList) {
        await navigate(url);
        const tableData = [];

        if (url.toLowerCase().includes('attendance')) {
          const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
          ];
          const currentDate = new Date();
          const currentMonth = currentDate.getMonth() + 1; // JavaScript months are 0-based
          const currentYear = currentDate.getFullYear();

          for (let increment = -1; increment <= 1; increment++) { // -1, 0, 1 for previous, current, next month
            let adjustedMonth = ((currentMonth + increment - 1) % 12) + 1;
            let adjustedYear = currentYear;

            // Adjust the year if the month rolls over
            if (adjustedMonth === 12 && increment === -1) {
              adjustedYear -= 1; // Previous December -> Decrement year
            } else if (adjustedMonth === 1 && increment === 1) {
              adjustedYear += 1; // Next January -> Increment year
            }

            const selectedMonth = months[adjustedMonth - 1];

            // Select the month
            const monthSelect = await processElement(null, By.ID, 'month');
            const yearInput = await processElement(null, By.NAME, 'year');

            if (monthSelect && yearInput) {
              try {
                await monthSelect.click();
              } catch (error) {
                printError(`Error clicking month selector: ${error.message}`);
                continue;
              }

              // Select the month option
              const monthOption = await processElement(
                monthSelect,
                By.XPATH,
                `.//option[contains(text(), '${selectedMonth}')]`
              );
              if (monthOption) {
                try {
                  await monthOption.click();
                } catch (error) {
                  printError(`Error selecting month '${selectedMonth}': ${error.message}`);
                  continue;
                }
              } else {
                printWarning(`Month option '${selectedMonth}' not found.`);
                continue;
              }

              // Set the year; using sendKeys instead of setting value directly
              try {
                await yearInput.clear();
                await yearInput.sendKeys(adjustedYear.toString());
              } catch (error) {
                printWarning(`Error setting year '${adjustedYear}': ${error.message}`);
                continue;
              }

              // Click the search button
              const searchBtn = await processElement(
                null,
                By.XPATH,
                "//button[@type='submit' and contains(text(), 'Search')]"
              );
              if (searchBtn) {
                try {
                  await searchBtn.click();
                  // Optionally, wait for the table to reload
                  await driver.sleep(2000); // 2 seconds; adjust as needed or use explicit waits
                } catch (error) {
                  printWarning(`Error clicking search button: ${error.message}`);
                  continue;
                }
              } else {
                printWarning('Search button not found.');
                continue;
              }

              // Scrape table data for the selected month and year
              const scrapedData = await scrapeTableData(url);
              if (scrapedData.length > 0) {
                tableData.push(scrapedData);
              }
            } else {
              printError('Month selector or year input not found.');
            }
          }
        } else {
          const scrapedData = await scrapeTableData(url);
          if (scrapedData.length > 0) {
            tableData.push(scrapedData);
          }
        }

        if (tableData.length > 0) {
          // Flatten the array
          const flattened = tableData.flat();
          mainTableData[url] = flattened;
          printSuccess(`Successfully scraped ${capitalize(url)} table.`);
        }
      }

      if (Object.keys(mainTableData).length > 0) {
        const assetsPath = validateAndCreatePath();
        const jsonPath = path.join(assetsPath, 'data.json');

        try {
          fs.writeFileSync(jsonPath, JSON.stringify(mainTableData, null, 2));
          const relativePath = path.relative(process.cwd(), jsonPath);
          printSuccess(`Success! Data saved to: ${relativePath}`);
        } catch (error) {
          printError(`Error saving data to file: ${error.message}`);
        }
      } else {
        printError('No data collected from any of the URLs.');
      }
    } catch (error) {
      printError(`An unexpected error occurred: ${error.message}`);
    } finally {
      await driver.quit();
    }
  };

  // Helper function to capitalize the first letter
  const capitalize = (s) => {
    if (typeof s !== 'string') return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // Execute the main function
  main();
})();