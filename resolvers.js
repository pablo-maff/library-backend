const { UserInputError, AuthenticationError } = require('apollo-server')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const { PubSub } = require('graphql-subscriptions')
const pubsub = new PubSub()
require('dotenv').config()

const SECRET = process.env.SECRET

const resolvers = {
  Query: {
    bookCount: async () => Book.collection.countDocuments(),
    authorCount: async () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      // fix the author queries after fixing authors data
      if (args.author && args.genre) {
        return books.filter(
          (b) => b.author === args.author && b.genres.includes(args.genre)
        )
      }
      if (args.genre) {
        return Book.find({ genres: { $in: [args.genre] } })
      }
      if (args.author) {
        return books.filter((b) => b.author === args.author)
      }

      return Book.find({})
    },
    allAuthors: async () => Author.find({}),
    me: (root, args, context) => {
      return context.currentUser
    },
  },
  Book: {
    author: async (root) => {
      return Author.findById(root.author)
    },
  },
  Author: {
    bookCount: async (message, args, { loaders }) => {
      return loaders.books.load(message._id)
    },
  },
  Mutation: {
    addBook: async (root, args, { currentUser }) => {
      if (!currentUser) {
        throw new AuthenticationError('Not authenticated')
      }

      let author = await Author.findOne({ name: args.author })
      if (!author) {
        author = new Author({ name: args.author, born: args.born })
        try {
          await author.save()
        } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          })
        }
      }

      const book = new Book({
        title: args.title,
        published: args.published,
        genres: args.genres,
        author: author._id,
      })

      // send notification to subscribers
      pubsub.publish('BOOK_ADDED', { bookAdded: book })

      try {
        return book.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
    },
    editAuthor: async (root, args, { currentUser }) => {
      if (!currentUser) {
        throw new AuthenticationError('Not authenticated')
      }

      const author = await Author.findOne({ name: args.name })
      if (!author)
        throw new UserInputError('That author does not exist in the App')

      author.born = args.setBornTo

      return author.save()
    },
    createUser: async (root, args) => {
      const { username, password, favouriteGenre } = args

      const saltRounds = 10
      const passwordHash = await bcrypt.hash(password, saltRounds)

      const user = new User({
        username,
        passwordHash,
        favouriteGenre,
      })

      return user.save().catch((error) => {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      })
    },
    login: async (root, args) => {
      const { username, password } = args
      const user = await User.findOne({ username })

      const passwordCorrect =
        user === null
          ? false
          : await bcrypt.compare(password, user.passwordHash)

      if (!(user && passwordCorrect)) {
        throw new UserInputError('wrong credentials')
      }
      const userForToken = {
        username: user.username,
        id: user._id,
      }

      return { value: jwt.sign(userForToken, SECRET) }
    },
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED']),
    },
  },
}

module.exports = resolvers
