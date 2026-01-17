import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * POST /api/auto/run
 * Start auto test execution
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.discovery_id) {
      return errorResponse('discovery_id is required', 400);
    }
    
    console.log('[POST /api/auto/run]', { 
      discovery_id: body.discovery_id,
      mode: body.mode,
      safety: body.safety
    });
    
    const response = await proxyToBackend('/auto/run', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json(
          { error: 'An auto run is already in progress', detail: data.detail, status: 429 },
          { status: 429 }
        );
      }
      
      return NextResponse.json(
        { error: data.detail || 'Run failed to start', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[POST /api/auto/run] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse('Cannot connect to QA Agent backend', 502);
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}

/**
 * GET /api/auto/run
 * List all auto runs
 */
export async function GET() {
  try {
    console.log('[GET /api/auto/run] Listing runs');
    
    const response = await proxyToBackend('/auto/runs');
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Failed to list runs', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[GET /api/auto/run] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse('Cannot connect to QA Agent backend', 502);
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
