import { NextRequest, NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

/**
 * POST /api/auto/discover
 * Start enhanced auto discovery
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.ui_url) {
      return errorResponse('ui_url is required', 400);
    }
    
    // Don't log credentials
    console.log('[POST /api/auto/discover]', { 
      ui_url: body.ui_url, 
      env: body.env 
    });
    
    const response = await proxyToBackend('/auto/discover', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || 'Discovery failed', status: response.status },
        { status: response.status }
      );
    }
    
    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[POST /api/auto/discover] Error:', error);
    
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return errorResponse('Cannot connect to QA Agent backend', 502);
    }
    
    return errorResponse(
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
