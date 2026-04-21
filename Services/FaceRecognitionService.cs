using System.Collections.Concurrent;
using FaceAiSharp;
using FaceAiSharp.Extensions;
using Microsoft.Extensions.Hosting;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using VEGA.Interfaces;

namespace VEGA.Services;

public class FaceRecognitionService : IFaceRecognitionService
{
    private readonly IFaceDetectorWithLandmarks _faceDetector;
    private readonly IFaceEmbeddingsGenerator _faceEmbedder;
    private readonly ConcurrentDictionary<string, float[]> _enrolledFaces;
    private readonly object _faceLock = new();
    private readonly string _persistencePath;

    public FaceRecognitionService(IHostEnvironment env)
    {
        _faceDetector = FaceAiSharpBundleFactory.CreateFaceDetectorWithLandmarks();
        _faceEmbedder = FaceAiSharpBundleFactory.CreateFaceEmbeddingsGenerator();

        _persistencePath = Path.Combine(env.ContentRootPath, "data", "enrollments.json");
        var loaded = JsonFileStore.Load(_persistencePath, () => new Dictionary<string, float[]>());
        _enrolledFaces = new ConcurrentDictionary<string, float[]>(loaded);
    }

    private void PersistEnrollments()
    {
        JsonFileStore.Save(_persistencePath, new Dictionary<string, float[]>(_enrolledFaces));
    }

    public FaceEnrollResult EnrollFace(string name, string imageBase64)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 50)
            return new FaceEnrollResult { Success = false, Error = "Name is required (max 50 chars)." };

        if (string.IsNullOrEmpty(imageBase64))
            return new FaceEnrollResult { Success = false, Error = "Image data is required." };

        // Strip data URI prefix
        var base64 = imageBase64.Contains(',') ? imageBase64[(imageBase64.IndexOf(',') + 1)..] : imageBase64;
        byte[] imageBytes;
        try { imageBytes = Convert.FromBase64String(base64); }
        catch { return new FaceEnrollResult { Success = false, Error = "Invalid base64 image." }; }

        lock (_faceLock)
        {
            using var img = Image.Load<Rgb24>(imageBytes);
            var faces = _faceDetector.DetectFaces(img);
            if (!faces.Any())
                return new FaceEnrollResult { Success = false, Error = "No face detected in image." };

            var face = faces.OrderByDescending(f => f.Confidence).First();
            var aligned = img.Clone();
            _faceEmbedder.AlignFaceUsingLandmarks(aligned, face.Landmarks!);
            var embedding = _faceEmbedder.GenerateEmbedding(aligned);

            _enrolledFaces[name] = embedding;
            PersistEnrollments();
            return new FaceEnrollResult
            {
                Success = true,
                Name = name,
                Message = $"Face enrolled for {name}.",
                TotalEnrolled = _enrolledFaces.Count
            };
        }
    }

    public FaceIdentifyResult IdentifyFace(string imageBase64)
    {
        if (string.IsNullOrEmpty(imageBase64))
            return new FaceIdentifyResult { Detected = false, Message = "Image data is required." };

        var base64 = imageBase64.Contains(',') ? imageBase64[(imageBase64.IndexOf(',') + 1)..] : imageBase64;
        byte[] imageBytes;
        try { imageBytes = Convert.FromBase64String(base64); }
        catch { return new FaceIdentifyResult { Detected = false, Message = "Invalid base64 image." }; }

        lock (_faceLock)
        {
            using var img = Image.Load<Rgb24>(imageBytes);
            var faces = _faceDetector.DetectFaces(img);
            if (!faces.Any())
                return new FaceIdentifyResult { Detected = false, Message = "No face detected." };

            var face = faces.OrderByDescending(f => f.Confidence).First();
            var aligned = img.Clone();
            _faceEmbedder.AlignFaceUsingLandmarks(aligned, face.Landmarks!);
            var embedding = _faceEmbedder.GenerateEmbedding(aligned);

            if (_enrolledFaces.IsEmpty)
                return new FaceIdentifyResult { Detected = true, Message = "No enrolled faces to match against." };

            // Find best match
            string? bestName = null;
            float bestScore = float.MinValue;
            foreach (var (eName, eVec) in _enrolledFaces)
            {
                var dot = embedding.Dot(eVec);
                if (dot > bestScore) { bestScore = dot; bestName = eName; }
            }

            var isMatch = bestScore >= 0.42f;

            return new FaceIdentifyResult
            {
                Detected = true,
                Identity = isMatch ? bestName : null,
                Confidence = Math.Round(bestScore, 4),
                Message = isMatch ? $"Identity verified: {bestName}" : "Unknown identity"
            };
        }
    }

    public IEnumerable<string> GetEnrolledUsers()
    {
        return _enrolledFaces.Keys.ToList();
    }

    public bool RemoveUser(string name)
    {
        if (_enrolledFaces.TryRemove(name, out _))
        {
            PersistEnrollments();
            return true;
        }
        return false;
    }

    public bool IsUserEnrolled(string name)
    {
        return _enrolledFaces.ContainsKey(name);
    }
}
