import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * POST /api/run
 * Proxy to QA_AGENT_API_URL/run
 * 
 * Body: { discovery_id, suite?, prompt? }
 * Returns: { run_id, status }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.discovery_id) {
      return errorResponse('discovery_id is required', 400);
    }
    
    console.log('[POST /api/run]', { 
      discovery_id: body.discovery_id, 
      suite: body.suite || 'smoke' 
    });
    
    // Forward to backend
    const response = await proxyToBackend('/run', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    // Handle backend errors
    if (!response.ok) {
      // Special handling for rate limit
      if (response.status === 429) {
        return NextResponse.json(
          { 
            error: 'A test run is already in progress',
            detail: data.detail,
            status: 429 
          },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { 
          error: data.detail || 'Run failed to start',
          status: response.status 
        },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[POST /api/run] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse(
        'Cannot connect to QA Agent backend',
        502,
        'Make sure the backend is running'
      );
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}

/**
 * GET /api/run
 * Proxy to QA_AGENT_API_URL/runs (list all runs)
 */
export async function GET() {
  try {
    console.log('[GET /api/run] Listing runs');
    
    const response = await proxyToBackend('/runs');
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to list runs', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[GET /api/run] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse('Cannot connect to QA Agent backend', 502);
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
