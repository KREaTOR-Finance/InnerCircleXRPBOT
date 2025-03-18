# XRPL Token Explorer Bot

A powerful Telegram bot for exploring token information on the XRP Ledger using the XRPL API and XRPL Meta API.

## Features

- **XRPL Address Recognition**: Simply send an XRPL address to the bot to get detailed token information
- **Token Analysis**: Get comprehensive information about tokens on the XRP Ledger
- **Token Holders**: View the top holders of a token
- **Token Search**: Search for tokens by name
- **Direct Command Interface**: Use dedicated commands for specific token information

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file based on `.env.example` and fill in your configuration values
4. Start the bot:
   ```
   npm start
   ```

## Usage

### Address Recognition

Simply send an XRPL address (starting with "r") to the bot, and it will automatically analyze it and provide token information if the address has issued any tokens.

Example: Send `rMRDGXkjJnjfhMoGZpB4hJEgEyJL7YRcnQ` to the bot.

### Commands

The bot supports the following commands:

- `/xrpltoken <currency> <issuer>` - Get detailed information about a token
  Example: `/xrpltoken USD rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B`

- `/xrplsearch <query>` - Search for tokens by name
  Example: `/xrplsearch Bitstamp`

- `/xrplholders <issuer>` - List token holders for an issuer
  Example: `/xrplholders rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B`

- `/xrplhelp` - Show help for XRPL commands

## API Integration

The bot uses two primary APIs:

1. **XRPL API** - For accessing core XRP Ledger data
2. **XRPL Meta API** - For retrieving extended metadata, social information, and metrics

## Environment Variables

Create a `.env` file with the following variables:

```
# Bot Configuration
BOT_TOKEN=your_telegram_bot_token
ADMIN_CHAT_ID=your_admin_chat_id

# XRPL API Configuration
XRPL_API_URL=https://api.xrpldata.com

# XRPLMeta API Configuration
XRPL_META_API_URL=https://api.xrplmeta.org
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 