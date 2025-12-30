import express from 'express';
import axios from 'axios';

const router = express.Router();

// In-memory storage for IPAM records (can be moved to MongoDB)
let ipamRecords = [];

/**
 * Fetch IPAM data and store UUID and IP with status "creating"
 * POST /api/ipam/fetch-and-store
 */
router.post('/fetch-and-store', async (req, res) => {
  try {
    const {
      url = 'https://north.cloud.airtel.in/api/v1/ipam?offset=0&limit=10&search=',
      headers = {}
    } = req.body;

    // Make the API call
    const response = await axios.get(url, {
      headers: {
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
        'username': 'amit.nigam@coredge.io',
        ...headers
      }
    });

    const data = response.data;
    const storedRecords = [];

    // Extract UUID and IP from response
    // Assuming the response has a structure like { data: [...] } or is an array
    const items = data.data || data.items || data.results || (Array.isArray(data) ? data : []);

    items.forEach((item) => {
      // Extract UUID - could be in different fields
      const uuid = item.uuid || item.id || item.uid || item._id;
      
      // Extract IP - could be in different fields
      const ip = item.ip || item.ipAddress || item.ip_address || item.address || 
                 item.publicIp || item.public_ip || item.privateIp || item.private_ip;

      if (uuid && ip) {
        const record = {
          uuid,
          ip,
          status: 'creating',
          createdAt: new Date().toISOString(),
          originalData: item // Store original data for reference
        };

        // Check if record already exists
        const existingIndex = ipamRecords.findIndex(r => r.uuid === uuid);
        if (existingIndex >= 0) {
          // Update existing record
          ipamRecords[existingIndex] = { ...ipamRecords[existingIndex], ...record };
          storedRecords.push(ipamRecords[existingIndex]);
        } else {
          // Add new record
          ipamRecords.push(record);
          storedRecords.push(record);
        }
      }
    });

    res.json({
      success: true,
      message: `Stored ${storedRecords.length} IPAM records with status "creating"`,
      records: storedRecords,
      totalRecords: ipamRecords.length
    });
  } catch (error) {
    console.error('Error fetching and storing IPAM data:', error);
    res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to fetch and store IPAM data',
      message: error.message,
      details: error.response?.data || error.message
    });
  }
});

/**
 * Get all stored IPAM records
 * GET /api/ipam/records
 */
router.get('/records', (req, res) => {
  const { status, uuid, ip } = req.query;
  
  let filteredRecords = [...ipamRecords];

  // Filter by status
  if (status) {
    filteredRecords = filteredRecords.filter(r => r.status === status);
  }

  // Filter by UUID
  if (uuid) {
    filteredRecords = filteredRecords.filter(r => r.uuid === uuid);
  }

  // Filter by IP
  if (ip) {
    filteredRecords = filteredRecords.filter(r => r.ip === ip);
  }

  res.json({
    success: true,
    records: filteredRecords,
    total: filteredRecords.length
  });
});

/**
 * Update IPAM record status
 * PUT /api/ipam/records/:uuid
 */
router.put('/records/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { status, ip } = req.body;

  const recordIndex = ipamRecords.findIndex(r => r.uuid === uuid);
  
  if (recordIndex < 0) {
    return res.status(404).json({
      success: false,
      error: 'Record not found'
    });
  }

  // Update record
  if (status) {
    ipamRecords[recordIndex].status = status;
  }
  if (ip) {
    ipamRecords[recordIndex].ip = ip;
  }
  ipamRecords[recordIndex].updatedAt = new Date().toISOString();

  res.json({
    success: true,
    record: ipamRecords[recordIndex]
  });
});

/**
 * Delete IPAM record
 * DELETE /api/ipam/records/:uuid
 */
router.delete('/records/:uuid', (req, res) => {
  const { uuid } = req.params;
  
  const recordIndex = ipamRecords.findIndex(r => r.uuid === uuid);
  
  if (recordIndex < 0) {
    return res.status(404).json({
      success: false,
      error: 'Record not found'
    });
  }

  const deletedRecord = ipamRecords.splice(recordIndex, 1)[0];

  res.json({
    success: true,
    message: 'Record deleted',
    record: deletedRecord
  });
});

export default router;



