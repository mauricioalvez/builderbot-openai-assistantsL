import "dotenv/config"
import { createBot, createProvider, createFlow, addKeyword, EVENTS } from '@builderbot/bot'
import { MemoryDB } from '@builderbot/bot'
import { BaileysProvider } from '@builderbot/provider-baileys'
import { toAsk, httpInject } from "@builderbot-plugins/openai-assistants"
import { typing, recording } from "./utils/presence"
import path from 'path'
import fs from 'fs'

import OpenAI from 'openai'


const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''

const openai = new OpenAI()

/** Puerto en el que se ejecutará el servidor */
const PORT = process.env.PORT ?? 3008
/** ID del asistente de OpenAI */
const ASSISTANT_ID = process.env.ASSISTANT_ID ?? ''
const userQueues = new Map();
const userLocks = new Map(); // New lock mechanism

/**
 * Function to process the user's message by sending it to the OpenAI API
 * and sending the response back to the user.
 */
const processUserMessage = async (ctx, { flowDynamic, state, provider }) => {
    await typing(ctx, provider);
    const response = await toAsk(ASSISTANT_ID, ctx.body, state);

    // Split the response into chunks and send them sequentially
    //const chunks = response.split(/\n\n+/);
    //for (const chunk of chunks) {
      
        //const cleanedChunk = chunk.trim().replace(/【.*?】[ ] /g, "");
        //await flowDynamic([{ body: cleanedChunk }]);
    //}
    await flowDynamic([{ body: response }])
};

/**
 * Function to handle the queue for each user.
 */
const handleQueue = async (userId) => {
    const queue = userQueues.get(userId);
    
    if (userLocks.get(userId)) {
        return; // If locked, skip processing
    }

    while (queue.length > 0) {
        userLocks.set(userId, true); // Lock the queue
        const { ctx, flowDynamic, state, provider } = queue.shift();
        try {
            await processUserMessage(ctx, { flowDynamic, state, provider });
        } catch (error) {
            console.error(`Error processing message for user ${userId}:`, error);
        } finally {
            userLocks.set(userId, false); // Release the lock
        }
    }

    userLocks.delete(userId); // Remove the lock once all messages are processed
    userQueues.delete(userId); // Remove the queue once all messages are processed
};

/**
 * Flujo de nota de voz
 * Respuesta texto y audio
 */
const voiceNoteFlow = addKeyword<BaileysProvider, MemoryDB>(EVENTS.VOICE_NOTE)
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        await recording(ctx, provider)
        try {
            // Guardar archivo de audio localmente
            const to = ctx.from
            await flowDynamic('\u{1F4A1} Audio')
            const localPath = await provider.saveFile(ctx, { path: './assets/'})
            //await flowDynamic(localPath)
            //console.log('Ruta del archivo de audio local:', localPath)

            // Leer el archivo de audio
            const audioData = fs.createReadStream(localPath);

            // Transcribir el audio usando OpenAI
            const transcribeResponse = await openai.audio.transcriptions.create({
                file: audioData,
                model: 'whisper-1',
            });
            const transcription = transcribeResponse.text;
            console.log('Transcripción del audio:', transcription);

            // Obtener respuesta del asistente de OpenAI basado en la transcripción
            
            const askToAiResponse = await toAsk(ASSISTANT_ID, transcription, state);
            console.log('Respuesta del asistente de OpenAI:', askToAiResponse);
            //await flowDynamic('Transcripción del audio: ' + transcription);
            await flowDynamic(askToAiResponse);


            // Convertir la respuesta en un archivo de audio
            const audioUrl = await noteToVoiceFlow(askToAiResponse);
            //console.log('Archivo de audio generado:', audioUrl);

            // Devolver el audio como respuesta
            await flowDynamic([{ media: audioUrl }]);
            fs.unlinkSync(localPath);
            fs.unlinkSync(audioUrl);

        } catch (error) {
            console.error('Error al procesar la nota de voz:', error);
            await flowDynamic('Hubo un error al procesar la nota de voz. Por favor, intenta enviar un mensaje de texto.');
        }
    });
// TEXTO A VOZ
const noteToVoiceFlow = async (text: string) => {
    const speechFilePath = path.resolve('./assets/speech_${Date.now()}.mp3');
    try {
        const mp3 = await openai.audio.speech.create({
            model: "tts-1",
            voice: "shimmer",
            input: text,
        });

        const buffer = Buffer.from(await mp3.arrayBuffer());
        await fs.promises.writeFile(speechFilePath, buffer);
        return speechFilePath;
    } catch (error) {
        console.error('Error al generar el audio:', error);
        throw new Error('Error al generar el audio');
    }
};


/**
 * Flujo de bienvenida que maneja las respuestas del asistente de IA
 * @type {import('@builderbot/bot').Flow<BaileysProvider, MemoryDB>}
 */
const welcomeFlow = addKeyword<BaileysProvider, MemoryDB>(EVENTS.WELCOME)
    .addAction(async (ctx, { flowDynamic, state, provider }) => {
        const userId = ctx.from; // Use the user's ID to create a unique queue for each user

        if (!userQueues.has(userId)) {
            userQueues.set(userId, []);
        }

        const queue = userQueues.get(userId);
        queue.push({ ctx, flowDynamic, state, provider });

        // If this is the only message in the queue, process it immediately
        if (!userLocks.get(userId) && queue.length === 1) {
            await handleQueue(userId);
        }
    });

/**
 * Función principal que configura y inicia el bot
 * @async
 * @returns {Promise<void>}
 */
const main = async () => {
    /**
     * Flujo del bot
     * @type {import('@builderbot/bot').Flow<BaileysProvider, MemoryDB>}
     */
    const adapterFlow = createFlow([welcomeFlow, voiceNoteFlow]);

    /**
     * Proveedor de servicios de mensajería
     * @type {BaileysProvider}
     */
    const adapterProvider = createProvider(BaileysProvider, {
        groupsIgnore: true,
        readStatus: false,
    });

    /**
     * Base de datos en memoria para el bot
     * @type {MemoryDB}
     */
    const adapterDB = new MemoryDB();

    /**
     * Configuración y creación del bot
     * @type {import('@builderbot/bot').Bot<BaileysProvider, MemoryDB>}
     */
    const { httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    httpInject(adapterProvider.server);
    httpServer(+PORT);
};

main();
