#!/usr/bin/env node

/**
 * Script to fetch IPAM data and extract UUID and public IP
 * Stores them in an array for use in other curl commands
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const IPAM_URL = 'https://north.cloud.airtel.in/api/v1/ipam?offset=0&limit=10&search=';
const OUTPUT_FILE = path.join(__dirname, '../data/ipam-data.json');

// Headers from the curl command
const headers = {
  'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7',
  'Connection': 'keep-alive',
  'Referer': 'https://north.cloud.airtel.in/security/nat-gateway',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  'accept': 'application/json',
  'ce-region': 'north',
  'external-project': 'cell-1',
  'organisation-id': '2d9ec5aa-ee7e-424f-b74d-aac23b54f427',
  'organisation-name': 'perftest',
  'project-id': '28',
  'project-name': 'cell-1',
  'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'username': 'amit.nigam@coredge.io'
};

// Cookies from the curl command (updated with latest token)
const cookies = '_sfid_eaef={%22anonymousId%22:%22e7366928f29cc8b0%22%2C%22consents%22:[]}; _ga=GA1.1.1026016170.1763137404; _evga_b2f1={%22uuid%22:%22e7366928f29cc8b0%22%2C%22puid%22:%22FMJt4-GbEY4rCb2leSCSsKoTeMBzgJ4KLJnS51awBoYohzjgEWy_MUwbzbzIFzwxrjHxWQeRqeiQbEDrCMJAEwAqkUQ9EV2TmrREbTcveKZEnfGk-5DFIrSKNoqIBVfv%22%2C%22affinityId%22:%220Lh%22}; moe_uuid=886c0d9d-6011-4e61-af7c-943361664a65; __utma=119537561.1026016170.1763137404.1765337966.1765337966.1; __utmz=119537561.1765337966.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); __utmv=119537561.|5=vid=609941765337965787=1; _ga_HS30BG2MNT=GS2.1.s1765337966$o1$g1$t1765337983$j43$l0$h0; _ga_L722EHW79W=GS2.1.s1765337966$o1$g1$t1765337983$j43$l0$h0; _ga_N4JFZSR7LN=GS2.1.s1766559529$o126$g1$t1766559533$j56$l0$h0; COMPASS_AUTH=eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJreVhaOG8xS2ZvcDEtOHJLZGotLUE2cTBmZ25IY2RGdDhWek4xYnBvQ1drIn0.eyJleHAiOjE3NjY1NjY5MjQsImlhdCI6MTc2NjU2NjYyNCwiYXV0aF90aW1lIjoxNzY2NTU5NTM0LCJqdGkiOiI1ZWE5OTQ2NS1jOTMxLTRkNjQtOTQxZi03N2Q5OWNhNDMxNTkiLCJpc3MiOiJodHRwczovL25vcnRoLWF1dGguY2xvdWQuYWlydGVsLmluL2F1dGgvcmVhbG1zL2FpcnRlbCIsImF1ZCI6WyJjb250cm9sbGVyIiwiYWNjb3VudCJdLCJzdWIiOiIzZmEyNWU4ZC0yZjdlLTQ0NmEtODc5Yi1lNDUxM2EwYWVmY2QiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJjb250cm9sbGVyIiwibm9uY2UiOiI4MGIxODkxNS1lYTBkLTQ5NjQtYmI3MC1kOWJjMDhkMmRhMjAiLCJzZXNzaW9uX3N0YXRlIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiYWNyIjoiMCIsImFsbG93ZWQtb3JpZ2lucyI6WyIqIl0sInJlYWxtX2FjY2VzcyI6eyJyb2xlcyI6WyJvZmZsaW5lX2FjY2VzcyIsInVtYV9hdXRob3JpemF0aW9uIiwiZGVmYXVsdC1yb2xlcy1haXJ0ZWwiXX0sInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiLCJ2aWV3LXByb2ZpbGUiXX19LCJzY29wZSI6Im9wZW5pZCBlbWFpbCBwcm9maWxlIiwic2lkIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJhbWl0IG5pZ2FtIiwicmVhbG0iOiJhaXJ0ZWwiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJhbWl0Lm5pZ2FtQGNvcmVkZ2UuaW8iLCJnaXZlbl9uYW1lIjoiYW1pdCIsImZhbWlseV9uYW1lIjoibmlnYW0iLCJlbWFpbCI6ImFtaXQubmlnYW1AY29yZWRnZS5pbyJ9.o9AJ8kuz1GjLv-ewRtWzE9Ti6IXsDdQrDWftaGG0RyQLHHtr1oetE9fm6H47QnP4CPVBAf0JF3UQyQ_zGl9gXt9znSFUiScV2nV2tvnD4-6HuLIU3P3hggIxOydLdNymW0jhzvXCa_lFxh_bRXwdL7jcNFKPegtml2UqmXVFOQsCV_bq0uCqAQf71CIOLJqKA49ZC0Y0Zbwk1DmiQCOAefGWS9v5UzUht_Wl6cj_uuiBFR3PRdAh7ySSATMnX8Krim4dSehve_muPWlNTgn1zD-xcD5wHHvTHwKNi3mYtUwDh6Kck_PlD-uGP4HbBhNMLMkBwvys29RlXDS1VfLjhw';

// Authorization token
const authToken = 'eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIiA6ICJreVhaOG8xS2ZvcDEtOHJLZGotLUE2cTBmZ25IY2RGdDhWek4xYnBvQ1drIn0.eyJleHAiOjE3NjY1NjY5MjQsImlhdCI6MTc2NjU2NjYyNCwiYXV0aF90aW1lIjoxNzY2NTU5NTM0LCJqdGkiOiI1ZWE5OTQ2NS1jOTMxLTRkNjQtOTQxZi03N2Q5OWNhNDMxNTkiLCJpc3MiOiJodHRwczovL25vcnRoLWF1dGguY2xvdWQuYWlydGVsLmluL2F1dGgvcmVhbG1zL2FpcnRlbCIsImF1ZCI6WyJjb250cm9sbGVyIiwiYWNjb3VudCJdLCJzdWIiOiIzZmEyNWU4ZC0yZjdlLTQ0NmEtODc5Yi1lNDUxM2EwYWVmY2QiLCJ0eXAiOiJCZWFyZXIiLCJhenAiOiJjb250cm9sbGVyIiwibm9uY2UiOiI4MGIxODkxNS1lYTBkLTQ5NjQtYmI3MC1kOWJjMDhkMmRhMjAiLCJzZXNzaW9uX3N0YXRlIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiYWNyIjoiMCIsImFsbG93ZWQtb3JpZ2lucyI6WyIqIl0sInJlYWxtX2FjY2VzcyI6eyJyb2xlcyI6WyJvZmZsaW5lX2FjY2VzcyIsInVtYV9hdXRob3JpemF0aW9uIiwiZGVmYXVsdC1yb2xlcy1haXJ0ZWwiXX0sInJlc291cmNlX2FjY2VzcyI6eyJhY2NvdW50Ijp7InJvbGVzIjpbIm1hbmFnZS1hY2NvdW50IiwibWFuYWdlLWFjY291bnQtbGlua3MiLCJ2aWV3LXByb2ZpbGUiXX19LCJzY29wZSI6Im9wZW5pZCBlbWFpbCBwcm9maWxlIiwic2lkIjoiYmFjYWI2NWMtNmM5ZC00Zjk4LTgyNmEtMWMyODYwMTg1MDllIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsIm5hbWUiOiJhbWl0IG5pZ2FtIiwicmVhbG0iOiJhaXJ0ZWwiLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJhbWl0Lm5pZ2FtQGNvcmVkZ2UuaW8iLCJnaXZlbl9uYW1lIjoiYW1pdCIsImZhbWlseV9uYW1lIjoibmlnYW0iLCJlbWFpbCI6ImFtaXQubmlnYW1AY29yZWRnZS5pbyJ9.o9AJ8kuz1GjLv-ewRtWzE9Ti6IXsDdQrDWftaGG0RyQLHHtr1oetE9fm6H47QnP4CPVBAf0JF3UQyQ_zGl9gXt9znSFUiScV2nV2tvnD4-6HuLIU3P3hggIxOydLdNymW0jhzvXCa_lFxh_bRXwdL7jcNFKPegtml2UqmXVFOQsCV_bq0uCqAQf71CIOLJqKA49ZC0Y0Zbwk1DmiQCOAefGWS9v5UzUht_Wl6cj_uuiBFR3PRdAh7ySSATMnX8Krim4dSehve_muPWlNTgn1zD-xcD5wHHvTHwKNi3mYtUwDh6Kck_PlD-uGP4HbBhNMLMkBwvys29RlXDS1VfLjhw';

async function fetchIPAMData() {
  try {
    console.log('📡 Fetching IPAM data...');
    
    const response = await axios.get(IPAM_URL, {
      headers: {
        ...headers,
        'Cookie': cookies,
        'authorization': `Bearer ${authToken}`
      }
    });

    const data = response.data;
    const items = data.items || data.data || [];

    // Extract UUID and IP for items with status "Creating" and username "amit.nigam@coredge.io"
    const creatingItems = items
      .filter(item => item.status === 'Creating' && item.username === 'amit.nigam@coredge.io')
      .map(item => ({
        uuid: item.uuid,
        ip: item.ip,
        status: item.status,
        object_name: item.object_name,
        target_vip: item.target_vip,
        az_name: item.az_name || 'N2', // Default to N2 if not present
        username: item.username
      }));

    // Also create a simple array format for easy use in curl commands
    const simpleArray = creatingItems.map(item => ({
      uuid: item.uuid,
      ip: item.ip
    }));

    // Prepare output data
    const outputData = {
      timestamp: new Date().toISOString(),
      totalItems: items.length,
      creatingItems: creatingItems.length,
      items: creatingItems,
      simpleArray: simpleArray,
      // Also include all items for reference
      allItems: items.map(item => ({
        uuid: item.uuid,
        ip: item.ip,
        status: item.status
      }))
    };

    // Ensure data directory exists
    const dataDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Save to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2));

    console.log(`✅ Successfully fetched and stored IPAM data`);
    console.log(`📊 Total items: ${items.length}`);
    console.log(`🔄 Items with status "Creating": ${creatingItems.length}`);
    console.log(`💾 Data saved to: ${OUTPUT_FILE}`);
    console.log('\n📋 UUID and IP Array:');
    console.log(JSON.stringify(simpleArray, null, 2));

    // Also output as a shell-friendly format
    console.log('\n🔧 Shell-friendly format (for use in scripts):');
    simpleArray.forEach((item, index) => {
      console.log(`export IPAM_UUID_${index}="${item.uuid}"`);
      console.log(`export IPAM_IP_${index}="${item.ip}"`);
    });

    return outputData;
  } catch (error) {
    console.error('❌ Error fetching IPAM data:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run the script
fetchIPAMData();

