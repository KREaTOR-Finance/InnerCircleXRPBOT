import json
import asyncio
from datetime import datetime, timezone, timedelta
import aiohttp

class XRPLMonitor:
    def __init__(self, wallet_address, min_amount_group=20, min_amount_private=10):
        self.wallet_address = wallet_address
        self.min_amount_group = min_amount_group
        self.min_amount_private = min_amount_private
        self.websocket_url = "wss://xrplcluster.com"
        self.last_processed_tx = None
        self.payment_callbacks = []

    def add_payment_callback(self, callback):
        """Add a callback function to be called when payment is received"""
        self.payment_callbacks.append(callback)

    async def verify_payment(self, tx_hash):
        """Verify a specific transaction"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post('https://xrplcluster.com/', json={
                    "method": "tx",
                    "params": [{
                        "transaction": tx_hash,
                        "binary": False
                    }]
                }) as response:
                    if response.status == 200:
                        data = await response.json()
                        return self._process_transaction(data.get('result', {}))
        except Exception as e:
            print(f"❌ Error verifying transaction {tx_hash}: {e}")
        return None

    def _process_transaction(self, tx):
        """Process a transaction and return payment details if valid"""
        try:
            if not tx or tx.get('TransactionType') != 'Payment':
                return None

            if tx.get('Destination') != self.wallet_address:
                return None

            amount = float(tx.get('Amount', '0')) / 1_000_000  # Convert drops to XRP
            destination_tag = tx.get('DestinationTag')
            
            if not destination_tag:
                return None

            # Check if amount meets minimum requirements
            is_valid_group = amount >= self.min_amount_group
            is_valid_private = amount >= self.min_amount_private

            return {
                'tx_hash': tx.get('hash'),
                'amount': amount,
                'destination_tag': destination_tag,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'is_valid_group': is_valid_group,
                'is_valid_private': is_valid_private
            }
        except Exception as e:
            print(f"❌ Error processing transaction: {e}")
            return None

    async def _notify_callbacks(self, payment_info):
        """Notify all registered callbacks about the payment"""
        for callback in self.payment_callbacks:
            try:
                await callback(payment_info)
            except Exception as e:
                print(f"❌ Error in payment callback: {e}")

    async def monitor_payments(self):
        """Monitor XRPL for incoming payments"""
        while True:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.ws_connect(self.websocket_url) as ws:
                        # Subscribe to transactions
                        await ws.send_json({
                            "command": "subscribe",
                            "streams": ["transactions"],
                            "accounts": [self.wallet_address]
                        })

                        print("✅ Connected to XRPL websocket")

                        async for msg in ws:
                            if msg.type == aiohttp.WSMsgType.TEXT:
                                data = json.loads(msg.data)
                                
                                if 'transaction' in data:
                                    payment_info = self._process_transaction(data['transaction'])
                                    if payment_info:
                                        await self._notify_callbacks(payment_info)

            except Exception as e:
                print(f"❌ XRPL WebSocket error: {e}")
                await asyncio.sleep(5)  # Wait before reconnecting

    async def start_monitoring(self):
        """Start monitoring XRPL payments"""
        while True:
            try:
                await self.monitor_payments()
            except Exception as e:
                print(f"❌ Error in payment monitoring: {e}")
                await asyncio.sleep(5)  # Wait before retrying 