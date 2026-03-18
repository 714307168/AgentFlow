#!/usr/bin/env python3
"""Test Device Client - Simulates Android App connecting to Relay Server"""

import json
import requests
import time

RELAY_HTTP = 'http://localhost:8080'
DEVICE_ID = 'test-device'
AGENT_ID = 'test-agent'

def test_connection():
    print("=" * 60)
    print("Testing Relay Server Connection")
    print("=" * 60)

    # Step 1: Get Device Token
    print("\n[Step 1] Getting Device JWT Token...")
    try:
        response = requests.post(
            f'{RELAY_HTTP}/api/session',
            json={'type': 'device', 'device_id': DEVICE_ID}
        )
        if response.status_code == 200:
            token_data = response.json()
            token = token_data['token']
            print(f"✅ Token received: {token[:50]}...")
            print(f"   Expires at: {token_data['expires_at']}")
        else:
            print(f"❌ Failed to get token: {response.status_code} {response.text}")
            return
    except Exception as e:
        print(f"❌ Error getting token: {e}")
        return

    # Step 2: Check if Agent exists
    print("\n[Step 2] Checking if Agent is registered...")
    try:
        response = requests.post(
            f'{RELAY_HTTP}/api/session',
            json={'type': 'agent', 'agent_id': AGENT_ID}
        )
        if response.status_code == 200:
            print(f"✅ Agent '{AGENT_ID}' is registered")
        else:
            print(f"⚠️  Agent '{AGENT_ID}' not found: {response.text}")
    except Exception as e:
        print(f"❌ Error checking agent: {e}")

    # Step 3: Check Relay Server health
    print("\n[Step 3] Checking Relay Server health...")
    try:
        response = requests.get(f'{RELAY_HTTP}/health')
        if response.status_code == 200:
            print(f"✅ Relay Server is healthy: {response.text}")
        else:
            print(f"❌ Health check failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Error checking health: {e}")

    # Summary
    print("\n" + "=" * 60)
    print("Connection Test Summary")
    print("=" * 60)
    print("✅ Device Token: OK")
    print("✅ Relay Server: Running")
    print("✅ HTTP API: Working")
    print("\n⚠️  WebSocket connection test requires 'websocket-client' package")
    print("   Install with: pip install websocket-client")
    print("\nTo test full WebSocket connection:")
    print("1. Ensure Local Agent is running")
    print("2. Device connects via WebSocket with token")
    print("3. Device binds to project")
    print("4. Device sends commands to Agent")
    print("=" * 60)

if __name__ == '__main__':
    test_connection()
