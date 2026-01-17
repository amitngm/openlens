import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const res = await fetch(`${BACKEND_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Run proxy error:', error);
    return NextResponse.json(
      { detail: 'Failed to connect to backend' },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  
  if (!id) {
    // List all runs
    try {
      const res = await fetch(`${BACKEND_URL}/runs`);
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch (error) {
      console.error('Runs list proxy error:', error);
      return NextResponse.json(
        { detail: 'Failed to connect to backend' },
        { status: 502 }
      );
    }
  }
  
  // Get specific run
  try {
    const res = await fetch(`${BACKEND_URL}/run/${id}`);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('Run GET proxy error:', error);
    return NextResponse.json(
      { detail: 'Failed to connect to backend' },
      { status: 502 }
    );
  }
}
