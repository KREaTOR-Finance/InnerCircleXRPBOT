# InnerCircleXRPBOT

A Telegram bot for tracking XRP token launches and AMM pools.

## Features

- Real-time token launch alerts
- AMM pool tracking
- FirstLedger integration
- XPMarket integration
- Premium subscription system
- Trial period support

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/InnerCircleXRPBOT.git
cd InnerCircleXRPBOT
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create your configuration:
```bash
cp example.config.json config.json
```

4. Edit `config.json` and add your:
- Telegram Bot Token (from @BotFather)
- FirstLedger API Key (optional)
- XRP Wallet Address

5. Run the bot:
```bash
python bot.py
```

## Configuration

The `config.json` file contains all sensitive information and should never be committed to git. The following fields are required:

```json
{
    "telegram_bot_token": "YOUR_BOT_TOKEN_HERE",
    "fl_api_key": "YOUR_FIRSTLEDGER_API_KEY",
    "xrp_wallet": "YOUR_XRP_WALLET_ADDRESS"
}
```

## Commands

- `/start` - Show menu
- `/check` - Manually check latest tokens
- `/upgrade` - Upgrade to premium
- `/trial` - Activate 24-hour free trial
- `/subscription` - Check premium status
- `/filter` - Set filtering options (coming soon)
- `/setkeywords` - Set keyword tracking (coming soon)

## Development

- All sensitive data is stored in `config.json` (gitignored)
- User data is stored in JSON files (gitignored)
- Logs are stored in the `logs` directory (gitignored)

## License

MIT License 