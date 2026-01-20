import { NextResponse } from 'next/server';
import { proxyToBackend, errorResponse } from '@/lib/api-client';

export async function GET() {
  try {
    // Try test_runner endpoint first
    let response = await proxyToBackend('/runs');
    if (!response.ok) {
      // Try alternative endpoint
      response = await proxyToBackend('/run/runs');
    }
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to fetch runs' }));
      return errorResponse(error.detail || 'Failed to fetch runs', response.status);
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch runs',
      500
    );
  }
}
