require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 4000;

app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(cookieParser());


const verifyToken = (req, res, next) => {
  const token = req.cookies?.token; 
  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    console.log(decoded); // Log the decoded token to check user info
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fizmj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB!");

    const historyCollection = client.db("HistoricalDB").collection("Historical");

    // Route to generate JWT token
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true });
    });

    // Route to logout and clear token
    app.post("/logout", (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: false,
        })
        .send({ success: true });
    });

    // POST: Add a new artifact
    app.post("/history", async (req, res) => {
      const artifact = req.body;

      if (!artifact.addedBy?.email) {
        return res.status(400).send({ message: "User email is required to add an artifact" });
      }

      artifact.likedBy = [];
      artifact.likeCount = 0;

      try {
        const result = await historyCollection.insertOne(artifact);
        if (result.insertedId) {
          res.status(201).send({
            message: "Artifact added successfully",
            insertedId: result.insertedId,
          });
        } else {
          res.status(400).send({ message: "Failed to add artifact" });
        }
      } catch (error) {
        console.error("Error adding artifact:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET: Fetch all artifacts with optional search functionality
    app.get("/history", async (req, res) => {
      const { search } = req.query;

      try {
        const query = search
          ? { name: { $regex: search, $options: "i" } } // Case-insensitive regex search
          : {};

        const artifacts = await historyCollection.find(query).toArray();
        res.send(artifacts);
      } catch (error) {
        console.error("Error fetching artifacts:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET: Fetch artifacts added by a specific user
    app.get("/my-artifacts", verifyToken, async (req, res) => {
      const { email } = req.query;
      if (req.user.email !== req.query.email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      try {
        const userArtifacts = await historyCollection.find({ "addedBy.email": email }).toArray();
        res.send(userArtifacts);
      } catch (error) {
        console.error("Error fetching user artifacts:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // PATCH: Toggle Like for an Artifact
    app.patch("/artifact/:id/like", async (req, res) => {
      const { id } = req.params;
      const { email } = req.body;

      if (!email) {
        return res.status(400).send({ message: "Email is required to toggle like status" });
      }

      try {
        const artifact = await historyCollection.findOne({ _id: new ObjectId(id) });

        if (!artifact) {
          return res.status(404).send({ message: "Artifact not found" });
        }

        // Ensure likedBy is an array
        artifact.likedBy = artifact.likedBy || [];

        // Check if the user already liked the artifact
        const hasLiked = artifact.likedBy.includes(email);

        const update = hasLiked
          ? {
              $inc: { likeCount: -1 }, // Decrease likeCount
              $pull: { likedBy: email }, // Remove email from likedBy array
            }
          : {
              $inc: { likeCount: 1 }, // Increase likeCount
              $addToSet: { likedBy: email }, // Add email to likedBy array
            };

        const result = await historyCollection.updateOne({ _id: new ObjectId(id) }, update);

        if (result.modifiedCount === 1) {
          res.status(200).send({ message: "Toggle like status successful", liked: !hasLiked });
        } else {
          res.status(500).send({ message: "Failed to toggle like status" });
        }
      } catch (error) {
        console.error("Error toggling like status:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // PATCH: Update an artifact
    app.patch("/artifact/:id", async (req, res) => {
      const { id } = req.params;
      const { name, image, type, description, createdAt, discoveredAt, discoveredBy, location } = req.body;

      try {
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            name,
            image,
            type,
            description,
            createdAt,
            discoveredAt,
            discoveredBy,
            location,
          },
        };

        const result = await historyCollection.updateOne(query, update);

        if (result.modifiedCount === 1) {
          res.status(200).send({ message: "Artifact updated successfully" });
        } else {
          res.status(404).send({ message: "Artifact not found or no changes made" });
        }
      } catch (error) {
        console.error("Error updating artifact:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // DELETE: Delete an artifact
    app.delete("/artifact/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await historyCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "Artifact deleted successfully" });
        } else {
          res.status(404).send({ message: "Artifact not found" });
        }
      } catch (error) {
        console.error("Error deleting artifact:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET: Fetch artifact by ID
    app.get("/artifact/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const artifact = await historyCollection.findOne({ _id: new ObjectId(id) });
        if (artifact) {
          res.send(artifact);
        } else {
          res.status(404).send({ message: "Artifact not found" });
        }
      } catch (error) {
        console.error("Error fetching artifact:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET: Fetch liked artifacts by user
    app.get("/liked-artifacts", verifyToken, async (req, res) => {
      const email = req.user.email; // Get email from the decoded token

      try {
        const likedArtifacts = await historyCollection.find({
          likedBy: email,
        }).toArray();

        if (likedArtifacts.length > 0) {
          res.send(likedArtifacts);
        } else {
          res.status(404).send({ message: "No liked artifacts found" });
        }
      } catch (error) {
        console.error("Error fetching liked artifacts:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

  } finally {
    // Do not close the client connection
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running...");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
