import requests
import time
import json
import logging
from datetime import datetime, timedelta, timezone
from telegram import Bot, Update, ForceReply, BotCommand, BotCommandScopeChat, BotCommandScopeAllGroupChats
from telegram.ext import Application, CommandHandler, CallbackContext, MessageHandler, filters
import asyncio
import aiohttp
import signal
import sys
import os
from collections import deque
from xrpl_payment import XRPLMonitor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
if not TELEGRAM_BOT_TOKEN:
    print("⚠️ Please set your TELEGRAM_BOT_TOKEN in .env file")
    sys.exit(1)

# API Configuration
FL_API_KEY = os.getenv('FL_API_KEY', '')
XRP_WALLET = os.getenv('XRP_WALLET', 'raymA4FrBEdLjJyWHX2icyFqwSbKquSTQd')
MIN_AMOUNT_GROUP = float(os.getenv('MIN_AMOUNT_GROUP', 20))
MIN_AMOUNT_PRIVATE = float(os.getenv('MIN_AMOUNT_PRIVATE', 10))
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'

# API Endpoints
FL_API_URL = 'https://firstledger.net/api/v1/tokens'
XRP_AMM_API_URL = 'https://api.xrpldata.com/v1/amm/pools'
XPMARKET_API_URL = 'https://api.xpmarket.com/api/meme/pools'

# Data files
FILES = {
    'groups': 'premium_groups.json',
    'users': 'premium_users.json',
    'trials': 'trial_users.json',
    'filters': 'premium_filters.json',
    'keywords': 'keyword_filters.json',
    'last_seen': 'last_seen_launches.json'
}

# Add these constants at the top with other constants
IMAGES_DIR = 'images'
NEW_TOKEN_IMAGE = os.path.join(IMAGES_DIR, 'new_token.jpg')
TOKEN_LIST_IMAGE = os.path.join(IMAGES_DIR, 'token_list.jpg')

def load_data(filename):
    """Load data from JSON file, create if doesn't exist"""
    try:
        with open(FILES[filename], 'r') as file:
            try:
                return json.load(file)
            except json.JSONDecodeError:
                # If file is empty or invalid, return empty dict
                return {}
    except FileNotFoundError:
        # Create file with empty dict if it doesn't exist
        save_data(filename, {})
        return {}

def save_data(filename, data):
    """Save data to JSON file"""
    with open(FILES[filename], 'w') as file:
        json.dump(data, file, indent=4)

async def start(update: Update, context: CallbackContext):
    """Start command - shows the menu"""
    menu = "🚀 *InnerCircleXRPBOT Menu*\n\n" \
           "🔹 `/menu` - Show this menu\n" \
           "🔹 `/start` - Show this menu\n" \
           "🔹 `/stop` - Stop receiving alerts\n" \
           "🔹 `/upgrade` - Upgrade to premium\n" \
           "🔹 `/trial` - Activate 24-hour free trial\n" \
           "🔹 `/check` - Manually check latest tokens\n" \
           "🔹 `/filter` - Set filtering options\n" \
           "🔹 `/setkeywords` - Set keyword tracking\n" \
           "🔹 `/subscription` - Check premium status\n" \
           "🔹 `/help` - Show command list"
    
    await update.message.reply_text(menu, parse_mode='Markdown')

async def stop(update: Update, context: CallbackContext):
    chat_id = str(update.message.chat_id)
    users = load_data('users')
    if chat_id in users:
        del users[chat_id]
        save_data('users', users)
    await update.message.reply_text("❌ You have stopped receiving alerts. Use `/start` to re-enable.")

async def upgrade(update: Update, context: CallbackContext):
    """Upgrade to premium"""
    await update.message.reply_text(
        "⬆️ *Upgrade to Premium*\n\n"
        "✅ *20 XRP* - Upgrade this group to real-time alerts\n"
        "✅ *10 XRP* - Receive real-time alerts in private chat\n"
        "🚀 *Send XRP to:* `raymAHFrBEdLjJyWHX2icyFqw5bKquSTQd`\n"
        "📌 Use your *Telegram Chat ID* as the *Destination Tag*.\n"
        "After payment, use `/subscription` to check your status.",
        parse_mode='Markdown'
    )

async def subscription(update: Update, context: CallbackContext):
    """Check subscription status"""
    chat_id = str(update.message.chat_id)
    users = load_data('users')
    trials = load_data('trials')
    
    if chat_id in users:
        expiry = users[chat_id].get('expires', 'Never')
        await update.message.reply_text(
            f"✅ *Premium Active*\n"
            f"Expires: {expiry}\n"
            f"Chat ID: `{chat_id}`",
            parse_mode='Markdown'
        )
    elif chat_id in trials:
        expiry = trials[chat_id].get('expires', 'Unknown')
        await update.message.reply_text(
            f"⏳ *Trial Active*\n"
            f"Expires: {expiry}\n"
            f"Chat ID: `{chat_id}`",
            parse_mode='Markdown'
        )
    else:
        await update.message.reply_text(
            "❌ No active subscription\n"
            f"Your Chat ID: `{chat_id}`\n"
            "Use /upgrade to activate premium",
            parse_mode='Markdown'
        )

async def fetch_projects():
    projects = []
    
    fl_headers = {
        'limit': 10,
        'offset': 0,
        'sort': 'created_at',
        'direction': 'desc'
    }
    fl_headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Authorization': 'Bearer ' + FL_API_KEY,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Origin': 'https://firstledger.net',
        'Referer': 'https://firstledger.net/tokens',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin'
    }
    
    xp_headers = {
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://xpmarket.com',
        'Referer': 'https://xpmarket.com/',
        'User-Agent': 'Mozilla/5.0'
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            # FirstLedger API
            print("🔍 Checking FirstLedger API...")
            params = {
                'limit': 10,
                'offset': 0,
                'sort': 'created_at',
                'direction': 'desc'
            }
            async with session.get(FL_API_URL, headers=fl_headers, params=params) as response:
                print(f"FirstLedger Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    print(f"FirstLedger Raw Data: {data[:100]}...")
                    print(f"FirstLedger Data: {len(data) if data else 'Empty'}")
                    for token in data:
                        projects.append({
                            "name": token["name"],
                            "website": token.get("website", "N/A"),
                            "twitter": token.get("twitter", "N/A"),
                            "market_cap": "N/A",
                            "holders": "N/A",
                            "source": "FL"
                        })
            
            # XPMarket API
            print("🔍 Checking XPMarket API...")
            params = {
                'limit': 10,
                'offset': 0,
                'sort': 'created_at',
                'sortDirection': 'desc',
                'og': 'true'
            }
            async with session.get(XPMARKET_API_URL, headers=xp_headers, params=params) as response:
                print(f"XPMarket Status: {response.status}")
                if response.status == 200:
                    data = await response.json()
                    print(f"XPMarket Raw Data: {data}")
                    launches = data.get('data', {}).get('items', [])
                    print(f"XPMarket Data: {len(launches)}")
                    projects.extend([{
                        "name": launch["title"],
                        "ticker": launch["ticker"],
                        "price": launch["price"],
                        "liquidity": launch["liquidity"],
                        "holders": launch["holders"],
                        "twitter": launch.get("twitter"),
                        "address": launch["address"],
                        "price_change": launch.get("priceChange"),
                        "created_at": launch["created_at"],
                        "logo": launch.get("logo"),
                        "source": "XP"
                    } for launch in launches])
            
            # AMM API
            print("🔍 Checking AMM API...")
            headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'InnerCircleXRPBot/1.0'
            }
            
            try:
                timeout = aiohttp.ClientTimeout(total=30)  # 30 second timeout
                async with session.post('https://xrplcluster.com/', 
                    json={
                        "method": "amm_info",
                        "params": [{
                            "ledger_index": "validated",
                            "limit": 10  # Limit to 10 most recent AMM pools
                        }]
                    },
                    headers=headers,
                    timeout=timeout
                ) as response:
                    print(f"AMM Status: {response.status}")
                    if response.status == 200:
                        data = await response.json()
                        print(f"AMM Raw Data: {data}")
                        result = data.get('result', {})
                        amm_info = result.get('amm', [])
                        
                        for amm in amm_info:
                            asset = amm.get('asset', {})
                            amount = amm.get('amount', {})
                            projects.append({
                                "name": f"AMM Pool - {asset.get('currency', 'Unknown')}/XRP",
                                "token_a": asset.get('currency', 'Unknown'),
                                "token_b": "XRP",
                                "liquidity_a": amount.get('value', 'N/A'),
                                "liquidity_b": amm.get('lp_token', {}).get('value', 'N/A'),
                                "trading_fee": "0.1",  # Default AMM fee
                                "source": "AMM"
                            })
            except asyncio.TimeoutError:
                print("❌ AMM API Timeout - trying fallback...")
                # Try fallback endpoint
                try:
                    timeout = aiohttp.ClientTimeout(total=30)  # 30 second timeout
                    async with session.post('https://s1.ripple.com:51234/', 
                        json={
                            "method": "amm_info",
                            "params": [{
                                "ledger_index": "validated",
                                "limit": 10  # Limit to 10 most recent AMM pools
                            }]
                        },
                        headers=headers,
                        timeout=timeout
                    ) as response:
                        print(f"AMM Fallback Status: {response.status}")
                        if response.status == 200:
                            data = await response.json()
                            print(f"AMM Fallback Raw Data: {data}")
                            result = data.get('result', {})
                            amm_info = result.get('amm', [])
                            
                            for amm in amm_info:
                                asset = amm.get('asset', {})
                                amount = amm.get('amount', {})
                                projects.append({
                                    "name": f"AMM Pool - {asset.get('currency', 'Unknown')}/XRP",
                                    "token_a": asset.get('currency', 'Unknown'),
                                    "token_b": "XRP",
                                    "liquidity_a": amount.get('value', 'N/A'),
                                    "liquidity_b": amm.get('lp_token', {}).get('value', 'N/A'),
                                    "trading_fee": "0.1",  # Default AMM fee
                                    "source": "AMM"
                                })
                except (asyncio.TimeoutError, Exception) as e:
                    print(f"❌ AMM Fallback API Error: {e}")
                    print("❌ Skipping AMM data due to API issues")
            except Exception as e:
                print(f"❌ AMM API Error: {e}")
                print("❌ Skipping AMM data due to API issues")
    except Exception as e:
        print(f"❌ Error fetching data: {e}")
    
    print(f"Total projects found: {len(projects)}")
    return projects

async def handle_new_chat_members(update: Update, context: CallbackContext):
    """Handle when bot is added to a new group"""
    # Only process if the bot itself was added
    if not any(member.id == context.bot.id for member in update.message.new_chat_members):
        return
        
    chat_id = str(update.message.chat_id)
    chat_type = update.message.chat.type
    
    if chat_type in ['group', 'supergroup']:
        # Set up commands menu for all groups
        commands = [
            BotCommand("menu", "Show available commands"),
            BotCommand("start", "Start the bot"),
            BotCommand("stop", "Stop receiving alerts"),
            BotCommand("upgrade", "Upgrade to premium"),
            BotCommand("trial", "Activate 24-hour free trial"),
            BotCommand("check", "Manually check latest tokens"),
            BotCommand("filter", "Set filtering options"),
            BotCommand("setkeywords", "Set keyword tracking"),
            BotCommand("subscription", "Check premium status"),
            BotCommand("help", "Show command list")
        ]
        
        try:
            # Set commands specifically for this chat
            await context.bot.set_my_commands(
                commands,
                scope=BotCommandScopeChat(int(chat_id))
            )
            
            # Also set commands for all groups to ensure visibility
            await context.bot.set_my_commands(
                commands,
                scope=BotCommandScopeAllGroupChats()
            )
            
            print(f"✅ Bot commands menu set for chat {chat_id}")
            
            # Add group to users list if not already present
            users = load_data('users')
            if chat_id not in users:
                users[chat_id] = {
                    'type': chat_type,
                    'name': update.message.chat.title,
                    'joined_date': datetime.now(timezone.utc).isoformat()
                }
                save_data('users', users)
            
            # Send welcome message with menu
            welcome_message = (
                f"👋 Thanks for adding me to {update.message.chat.title}!\n\n"
                "🔥 *Available Commands*:\n"
                "🔹 `/menu` - Show all commands\n"
                "🔹 `/check` - Check latest tokens\n"
                "🔹 `/upgrade` - Get premium access\n"
                "🔹 `/trial` - Start free trial\n"
                "🔹 `/subscription` - Check status\n"
                "🔹 `/filter` - Set filters\n"
                "🔹 `/help` - Get help\n\n"
                "💡 *Tip*: Click the menu button (☰) next to the message input to see all commands"
            )
            
            await update.message.reply_text(
                welcome_message,
                parse_mode='Markdown'
            )
            
        except Exception as e:
            print(f"❌ Error setting up bot in group: {e}")
            # Try to send basic welcome message
            await update.message.reply_text(
                f"👋 Thanks for adding me to {update.message.chat.title}!\n"
                "Use /start to begin."
            )

async def download_image(session, url):
    """Download image from URL and return bytes"""
    try:
        async with session.get(url) as response:
            if response.status == 200:
                return await response.read()
    except Exception as e:
        print(f"❌ Error downloading image from {url}: {e}")
    return None

async def check(update: Update, context: CallbackContext):
    """Manually check for latest tokens/projects"""
    try:
        projects = await fetch_projects()
        
        # Filter for XPMarket projects only
        xp_projects = [p for p in projects if p['source'] == 'XP']

        if not xp_projects:
            await update.message.reply_text("No new projects found at this time.", parse_mode="Markdown")
            return

        print(f"\n🟣 Sending {len(xp_projects)} XPMarket projects")
        
        # Send header message with token list image
        if os.path.exists(TOKEN_LIST_IMAGE):
            with open(TOKEN_LIST_IMAGE, 'rb') as photo_file:
                await update.message.reply_photo(
                    photo=photo_file,
                    caption="📊 *Latest XRP Projects*\n-------------------",
                    parse_mode="Markdown"
                )
        else:
            await update.message.reply_text("📊 *Latest XRP Projects*\n-------------------", parse_mode="Markdown")
        
        # Create session for downloading images
        async with aiohttp.ClientSession() as session:
            # Send each project as a separate message with its logo
            for project in xp_projects[:5]:  # Limit to 5 projects
                message = format_project_message(project)
                
                try:
                    image_data = None
                    if project.get('logo'):  # Try to get the logo
                        print(f"Downloading logo for {project['name']}: {project['logo']}")
                        image_data = await download_image(session, project['logo'])
                    
                    if image_data:
                        # Send with downloaded image
                        await update.message.reply_photo(
                            photo=image_data,
                            caption=message,
                            parse_mode="Markdown"
                        )
                        print(f"✅ Sent message with project logo for {project['name']}")
                    else:
                        # Fallback to default new token image
                        if os.path.exists(NEW_TOKEN_IMAGE):
                            with open(NEW_TOKEN_IMAGE, 'rb') as photo_file:
                                await update.message.reply_photo(
                                    photo=photo_file,
                                    caption=message,
                                    parse_mode="Markdown"
                                )
                                print(f"✅ Sent message with default image for {project['name']}")
                        else:
                            # Final fallback to text-only
                            await update.message.reply_text(
                                message,
                                parse_mode="Markdown",
                                disable_web_page_preview=True
                            )
                            print(f"✅ Sent text-only message for {project['name']}")
                    
                    # Small delay between messages to prevent rate limiting
                    await asyncio.sleep(0.5)
                    
                except Exception as e:
                    print(f"❌ Error sending project message for {project['name']}: {e}")
                    # Fallback to text-only on error
                    try:
                        await update.message.reply_text(
                            message,
                            parse_mode="Markdown",
                            disable_web_page_preview=True
                        )
                    except Exception as e:
                        print(f"❌ Error sending fallback text message: {e}")

    except Exception as e:
        print(f"❌ Error in check command: {str(e)}")
        await update.message.reply_text(f"❌ Error fetching projects: {str(e)}")

def format_project_message(project):
    """Format project data into a readable message"""
    try:
        message = f"🚀 *{project['name']}*\n"
        
        if project.get('website') and project['website'] != 'N/A':
            message += f"🌐 Website: {project['website']}\n"
        
        if project.get('twitter') and project['twitter'] != 'N/A':
            message += f"🐦 Twitter: @{project['twitter']}\n"
        
        if project.get('price') and project['price'] != 'N/A':
            price = float(project['price'])
            message += f"💰 Price: {price:.10f} XRP\n"
        
        if project.get('liquidity') and project['liquidity'] != 'N/A':
            message += f"💧 Liquidity: {project['liquidity']} XRP\n"
        
        if project.get('holders') and project['holders'] != 'N/A':
            message += f"👥 Holders: {project['holders']}\n"
            
        if project.get('price_change') and project['price_change'] != 'N/A':
            change = float(project['price_change'])
            emoji = "📈" if change > 0 else "📉"
            message += f"{emoji} 24h Change: {change}%\n"
        
        if project.get('address') and project['address'] != 'N/A':
            message += f"📍 Address: `{project['address']}`\n"
        
        # AMM specific fields
        if project['source'] == 'AMM':
            if project.get('token_a') and project['token_a'] != 'N/A':
                message += f"🔄 Pair: {project['token_a']}/{project['token_b']}\n"
            if project.get('liquidity_a') and project['liquidity_a'] != 'N/A':
                message += f"💧 Liquidity: {project['liquidity_a']} {project['token_a']} / {project['liquidity_b']} XRP\n"
            if project.get('volume_24h') and project['volume_24h'] != 'N/A':
                message += f"📊 24h Volume: {project['volume_24h']} XRP\n"
            if project.get('trading_fee') and project['trading_fee'] != 'N/A':
                message += f"💰 Fee: {project['trading_fee']}%\n"
        
        message += f"📊 Source: {project['source']}"
        return message
    except Exception as e:
        print(f"❌ Error formatting message for project {project.get('name', 'Unknown')}: {str(e)}")
        return f"❌ Error formatting project {project.get('name', 'Unknown')}"

async def trial(update: Update, context: CallbackContext):
    """Activate 24-hour trial"""
    chat_id = str(update.message.chat_id)
    trials = load_data('trials')
    users = load_data('users')

    if chat_id in users:
        await update.message.reply_text("You already have a premium subscription!")
        return

    if chat_id in trials:
        await update.message.reply_text("You have already used your trial period.")
        return

    # Set trial expiration to 24 hours from now
    expiry = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    trials[chat_id] = {
        'expires': expiry,
        'started': datetime.now(timezone.utc).isoformat()
    }
    save_data('trials', trials)
    
    await update.message.reply_text(
        "✅ Trial activated! You will receive alerts for the next 24 hours.\n"
        "Use /upgrade to get permanent access."
    )

async def menu(update: Update, context: CallbackContext):
    """Show the menu"""
    menu = "🚀 *InnerCircleXRPBOT Menu*\n\n" \
           "🔹 `/menu` - Show this menu\n" \
           "🔹 `/start` - Show this menu\n" \
           "🔹 `/stop` - Stop receiving alerts\n" \
           "🔹 `/upgrade` - Upgrade to premium\n" \
           "🔹 `/trial` - Activate 24-hour free trial\n" \
           "🔹 `/check` - Manually check latest tokens\n" \
           "🔹 `/filter` - Set filtering options\n" \
           "🔹 `/setkeywords` - Set keyword tracking\n" \
           "🔹 `/subscription` - Check premium status\n" \
           "🔹 `/help` - Show command list"
    
    await update.message.reply_text(menu, parse_mode='Markdown')

async def set_commands(app, chat_type=None):
    """Set bot commands in Telegram menu"""
    commands = [
        BotCommand("menu", "Show this menu"),
        BotCommand("start", "Show this menu"),
        BotCommand("stop", "Stop receiving alerts"),
        BotCommand("upgrade", "Upgrade to premium"),
        BotCommand("trial", "Activate 24-hour free trial"),
        BotCommand("check", "Manually check latest tokens"),
        BotCommand("filter", "Set filtering options"),
        BotCommand("setkeywords", "Set keyword tracking"),
        BotCommand("subscription", "Check premium status"),
        BotCommand("help", "Show command list")
    ]
    
    try:
        if chat_type:
            # Set commands for specific chat (group or private)
            scope = BotCommandScopeChat(chat_type) if isinstance(chat_type, int) else BotCommandScopeAllGroupChats()
            await app.bot.set_my_commands(commands, scope=scope)
        else:
            # Set default commands for all chats
            await app.bot.set_my_commands(commands)
            # Also set for groups specifically
            await app.bot.set_my_commands(commands, scope=BotCommandScopeAllGroupChats())
        print("✅ Bot commands menu updated successfully")
    except Exception as e:
        print(f"❌ Error setting bot commands: {e}")

async def filter(update: Update, context: CallbackContext):
    """Set filtering options"""
    await update.message.reply_text("🔧 Filter settings:\n\n"
                                  "Coming soon! This feature will allow you to filter alerts by:\n"
                                  "- Market cap\n"
                                  "- Volume\n"
                                  "- Number of holders")

async def setkeywords(update: Update, context: CallbackContext):
    """Set keyword tracking"""
    await update.message.reply_text("🔍 Keyword tracking:\n\n"
                                  "Coming soon! This feature will allow you to:\n"
                                  "- Add keywords to track\n"
                                  "- Remove keywords\n"
                                  "- View current keywords")

async def help(update: Update, context: CallbackContext):
    """Show command list"""
    await update.message.reply_text("ℹ️ *Available Commands*\n\n"
                                  "/menu - Show this menu\n"
                                  "/start - Show this menu\n"
                                  "/stop - Stop receiving alerts\n"
                                  "/upgrade - Upgrade to premium\n"
                                  "/trial - Activate 24-hour free trial\n"
                                  "/check - Manually check latest tokens\n"
                                  "/filter - Set filtering options\n"
                                  "/setkeywords - Set keyword tracking\n"
                                  "/subscription - Check premium status\n"
                                  "/help - Show this help message",
                                  parse_mode='Markdown')

async def alert_premium_users(app: Application, new_launch: dict):
    """Send alert to all premium and trial users"""
    users = load_data('users')
    trials = load_data('trials')
    current_time = datetime.now(timezone.utc)
    
    # Combine premium and active trial users
    all_users = {}
    all_users.update(users)
    for chat_id, trial in trials.items():
        expiry = datetime.fromisoformat(trial['expires'])
        if expiry > current_time:
            all_users[chat_id] = trial
    
    message = format_launch_alert(new_launch)
    
    for chat_id in all_users:
        try:
            # First send the NEW_TOKEN_IMAGE as an attention grabber
            if os.path.exists(NEW_TOKEN_IMAGE):
                await app.bot.send_photo(
                    chat_id=int(chat_id),
                    photo=open(NEW_TOKEN_IMAGE, 'rb'),
                    caption="🚨 *New Token Alert!*",
                    parse_mode='Markdown'
                )
                await asyncio.sleep(0.1)  # Small delay between messages
            
            # Then send the token information with its logo
            try:
                if new_launch.get('logo'):
                    await app.bot.send_photo(
                        chat_id=int(chat_id),
                        photo=new_launch['logo'],
                        caption=message,
                        parse_mode='Markdown'
                    )
                else:
                    # If no logo, send as text
                    await app.bot.send_message(
                        chat_id=int(chat_id),
                        text=message,
                        parse_mode='Markdown',
                        disable_web_page_preview=True
                    )
            except Exception as e:
                print(f"❌ Error sending project image: {e}")
                # Final fallback to text-only
                await app.bot.send_message(
                    chat_id=int(chat_id),
                    text=message,
                    parse_mode='Markdown',
                    disable_web_page_preview=True
                )
            
            await asyncio.sleep(0.1)  # Small delay to prevent rate limiting
            
        except Exception as e:
            print(f"❌ Error sending alert to {chat_id}: {e}")

def format_launch_alert(launch: dict) -> str:
    """Format a new launch alert message"""
    # Escape special characters in title and ticker
    title = launch['title'].replace('*', '\\*').replace('_', '\\_').replace('`', '\\`')
    ticker = launch['ticker'].replace('*', '\\*').replace('_', '\\_').replace('`', '\\`')
    
    message = f"🚨 *New Token Launch Alert\\!* 🚨\n\n"
    message += f"🎯 *{title}* ({ticker})\n"
    
    if launch.get('twitter'):
        twitter = launch['twitter'].replace('*', '\\*').replace('_', '\\_').replace('`', '\\`')
        message += f"🐦 Twitter: @{twitter}\n"
    
    message += f"💰 Price: {float(launch['price']):.12f} XRP\n"
    message += f"💧 Liquidity: {launch['liquidity']} XRP\n"
    message += f"👥 Holders: {launch['holders']}\n"
    
    if launch.get('priceChange'):
        emoji = "📈" if launch['priceChange'] > 0 else "📉"
        message += f"{emoji} Change: {launch['priceChange']}%\n"
    
    # Escape special characters in address
    address = launch['address'].replace('*', '\\*').replace('_', '\\_').replace('`', '\\`')
    message += f"📍 Address: `{address}`\n"
    message += f"\n⏰ Launch Time: {launch['created_at']}"
    
    return message

async def monitor_launches(app: Application):
    """Background task to monitor for new launches"""
    print("🔄 Launch monitoring started...")
    last_seen = load_data('last_seen')
    last_seen_id = last_seen.get('last_id', 0)
    
    while True:
        try:
            async with aiohttp.ClientSession() as session:
                # XPMarket API check
                params = {
                    'limit': 10,
                    'offset': 0,
                    'sort': 'created_at',
                    'sortDirection': 'desc',
                    'og': 'true'
                }
                
                headers = {
                    'Accept': 'application/json, text/plain, */*',
                    'Origin': 'https://xpmarket.com',
                    'Referer': 'https://xpmarket.com/',
                    'User-Agent': 'Mozilla/5.0'
                }
                
                async with session.get(XPMARKET_API_URL, headers=headers, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        launches = data.get('data', {}).get('items', [])
                        
                        if launches:
                            newest_id = max(launch['id'] for launch in launches)
                            
                            # Check for new launches
                            for launch in launches:
                                if launch['id'] > last_seen_id:
                                    print(f"🚀 New launch detected: {launch['title']}")
                                    await alert_premium_users(app, launch)
                            
                            # Update last seen ID
                            last_seen['last_id'] = newest_id
                            save_data('last_seen', last_seen)
                            last_seen_id = newest_id
        
        except Exception as e:
            print(f"❌ Error in launch monitoring: {e}")
        
        await asyncio.sleep(30)  # Check every 30 seconds

class Bot:
    def __init__(self):
        # Load configuration
        with open('config.json', 'r') as f:
            config = json.load(f)
        
        self.token = config['telegram_token']
        self.xrpl_wallet = config['xrp_wallet']
        min_amount_group = config.get('min_amount_group', 20)
        min_amount_private = config.get('min_amount_private', 10)
        
        # Initialize XRPL monitor
        self.xrpl_monitor = XRPLMonitor(
            self.xrpl_wallet,
            min_amount_group=min_amount_group,
            min_amount_private=min_amount_private
        )
        self.xrpl_monitor.add_payment_callback(self.handle_payment)
        
        # Initialize premium tracking
        self.premium_users = set()
        self.premium_groups = set()
        
        # Initialize other bot components
        self.processed_projects = deque(maxlen=100)
        self.last_check_time = None

    async def handle_payment(self, payment_info):
        """Handle incoming XRP payments"""
        try:
            chat_id = payment_info['destination_tag']
            amount = payment_info['amount']
            
            if payment_info['is_valid_group']:
                self.premium_groups.add(chat_id)
                await self.bot.send_message(
                    chat_id=chat_id,
                    text=f"✨ Thank you for your payment of {amount} XRP! This group has been upgraded to premium status.",
                    parse_mode='Markdown'
                )
            elif payment_info['is_valid_private']:
                self.premium_users.add(chat_id)
                await self.bot.send_message(
                    chat_id=chat_id,
                    text=f"✨ Thank you for your payment of {amount} XRP! Your account has been upgraded to premium status.",
                    parse_mode='Markdown'
                )
            else:
                await self.bot.send_message(
                    chat_id=chat_id,
                    text=f"❌ Payment of {amount} XRP received, but it's insufficient for an upgrade. Please check the required amounts.",
                    parse_mode='Markdown'
                )
        except Exception as e:
            print(f"❌ Error handling payment: {e}")

    async def upgrade(self, update: Update, context: CallbackContext):
        """Handle the /upgrade command"""
        chat_id = update.effective_chat.id
        is_group = update.effective_chat.type in ['group', 'supergroup']
        
        if is_group and chat_id in self.premium_groups:
            await update.message.reply_text("✨ This group already has premium status!")
            return
        elif not is_group and chat_id in self.premium_users:
            await update.message.reply_text("✨ You already have premium status!")
            return

        message = (
            "*🌟 Premium Upgrade Options*\n\n"
            f"Send XRP to: `{self.xrpl_wallet}`\n"
            f"Destination Tag: `{chat_id}`\n\n"
            "Pricing:\n"
            "✅ *20 XRP* - Upgrade this group to real-time alerts\n" if is_group else
            "✅ *10 XRP* - Receive real-time alerts in private chat\n"
            "\n*Important*:\n"
            "• Make sure to include the correct destination tag\n"
            "• Your upgrade will be activated automatically upon payment\n"
            "• Payment confirmation usually takes 3-5 seconds"
        )
        
        await update.message.reply_text(message, parse_mode='Markdown')

    async def start(self):
        """Start the bot and XRPL payment monitoring"""
        application = Application.builder().token(self.token).build()
        
        # Register handlers
        application.add_handler(CommandHandler("start", self.start_command))
        application.add_handler(CommandHandler("help", self.help))
        application.add_handler(CommandHandler("check", self.check))
        application.add_handler(CommandHandler("upgrade", self.upgrade))
        
        # Start XRPL payment monitoring in the background
        asyncio.create_task(self.xrpl_monitor.start_monitoring())
        
        # Start the bot
        await application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    # Create data files if they don't exist
    for filename in FILES.values():
        if not os.path.exists(filename):
            with open(filename, 'w') as f:
                json.dump({}, f)
    
    # Set up logging
    logging.basicConfig(
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        level=logging.INFO
    )
    
    # Initialize bot application with job queue
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Set up custom event loop policy for Windows
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    print("✅ InnerCircleXRPBOT is starting...")
    
    try:
        # Create and set new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Add handlers
        app.add_handler(MessageHandler(filters.StatusUpdate.NEW_CHAT_MEMBERS, handle_new_chat_members))
        app.add_handler(CommandHandler('start', start))
        app.add_handler(CommandHandler('menu', menu))
        app.add_handler(CommandHandler('stop', stop))
        app.add_handler(CommandHandler('upgrade', upgrade))
        app.add_handler(CommandHandler('subscription', subscription))
        app.add_handler(CommandHandler('check', check))
        app.add_handler(CommandHandler('trial', trial))
        app.add_handler(CommandHandler('filter', filter))
        app.add_handler(CommandHandler('setkeywords', setkeywords))
        app.add_handler(CommandHandler('help', help))
        
        # Define commands
        commands = [
            BotCommand("menu", "Show available commands"),
            BotCommand("start", "Start the bot"),
            BotCommand("stop", "Stop receiving alerts"),
            BotCommand("upgrade", "Upgrade to premium"),
            BotCommand("trial", "Activate 24-hour free trial"),
            BotCommand("check", "Manually check latest tokens"),
            BotCommand("filter", "Set filtering options"),
            BotCommand("setkeywords", "Set keyword tracking"),
            BotCommand("subscription", "Check premium status"),
            BotCommand("help", "Show command list")
        ]
        
        # Set commands globally and for all groups on startup
        async def setup_commands():
            try:
                # Set commands globally
                await app.bot.set_my_commands(commands)
                # Set commands for all groups
                await app.bot.set_my_commands(commands, scope=BotCommandScopeAllGroupChats())
                print("✅ Bot commands menu set up successfully")
            except Exception as e:
                print(f"❌ Error setting up bot commands: {e}")
        
        # Run the command setup
        loop.run_until_complete(setup_commands())
        
        # Create a background task for monitoring
        async def background_monitoring():
            while True:
                await monitor_launches(app)
                await asyncio.sleep(30)
        
        # Start the monitoring task
        loop.create_task(background_monitoring())
        
        print("✅ InnerCircleXRPBOT is running...")
        
        # Run the bot
        loop.run_until_complete(app.run_polling())
    except KeyboardInterrupt:
        print("\n✅ Bot stopped by user")
    except Exception as e:
        print(f"❌ Error: {e}")
