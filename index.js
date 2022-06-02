const { ApolloServer } = require('apollo-server-express')
const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const DataLoader = require('dataloader')
const { execute, subscribe } = require('graphql')
const { SubscriptionServer } = require('subscriptions-transport-ws') // This library is deprecated. See graphql-ws

const express = require('express')
const http = require('http')

const mongoose = require('mongoose')
const User = require('./models/user')
const Book = require('./models/book')
const Author = require('./models/author')

const typeDefs = require('./schema')
const resolvers = require('./resolvers')

const jwt = require('jsonwebtoken')
require('dotenv').config()

const SECRET = process.env.SECRET

const MONGODB_URI = process.env.MONGODB_URI

console.log('connecting to', MONGODB_URI)

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB', error.message)
  })

mongoose.set('debug', true)

// setup is now within a function
const start = async () => {
  const app = express()
  const httpServer = http.createServer(app)

  const schema = makeExecutableSchema({ typeDefs, resolvers })

  const subscriptionServer = SubscriptionServer.create(
    {
      schema,
      execute,
      subscribe,
    },
    {
      server: httpServer,
      path: '',
    }
  )

  const batchBooks = async (keys) => {
    let books = await Book.find({
      where: {
        author: {
          $in: keys,
        },
      },
    })
    return keys.map(
      (key) =>
        books.filter((book) => String(book.author) === String(key)).length
    )
  }

  const booksLoader = new DataLoader((keys) => batchBooks(keys))

  const server = new ApolloServer({
    schema,
    context: async ({ req }) => {
      const auth = req ? req.headers.authorization : null

      if (auth && auth.toLowerCase().startsWith('bearer')) {
        const decodedToken = jwt.verify(auth.substring(7), SECRET)
        const currentUser = await User.findById(decodedToken.id)
        return { currentUser }
      }

      if (req) {
        return {
          loaders: {
            books: booksLoader,
          },
        }
      }
    },
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              subscriptionServer.close()
            },
          }
        },
      },
    ],
  })

  await server.start()

  server.applyMiddleware({
    app,
    path: '/',
  })

  const PORT = 4000

  httpServer.listen(PORT, () =>
    console.log(`Server is now running on http://localhost:${PORT}`)
  )
}

// call the function that does the setup and starts the server
start()
