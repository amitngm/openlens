import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse, redactSensitive } from '@/lib/api-client';

/**
 * POST /api/discover
 * Proxy to QA_AGENT_API_URL/discover
 * 
 * Body: { ui_url, username, password, env }
 * Returns: { discovery_id, status }
 * 
 * Note: Credentials are forwarded but never persisted
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.ui_url) {
      return errorResponse('ui_url is required', 400);
    }
    
    // Log request (redacted)
    console.log('[POST /api/discover]', redactSensitive(body));
    
    // Forward to backend
    const response = await proxyToBackend('/discover', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    // Handle backend errors
    if (!response.ok) {
      return NextResponse.json(
        { 
          error: data.detail || 'Discovery failed',
          status: response.status 
        },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[POST /api/discover] Error:', error);
    
    // Connection error
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse(
        'Cannot connect to QA Agent backend',
        502,
        'Make sure the backend is running at ' + process.env.QA_AGENT_API_URL
      );
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
