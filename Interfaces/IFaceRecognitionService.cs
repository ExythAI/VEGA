namespace VEGA.Interfaces;

public interface IFaceRecognitionService
{
    FaceEnrollResult EnrollFace(string name, string imageBase64);
    FaceEnrollResult EnrollFace(string name, string imageBase64, bool force);
    FaceIdentifyResult IdentifyFace(string imageBase64);
    IEnumerable<string> GetEnrolledUsers();
    bool RemoveUser(string name);
    bool IsUserEnrolled(string name);
}

public class FaceEnrollResult
{
    public bool Success { get; set; }
    public string? Name { get; set; }
    public string? Error { get; set; }
    public string? Message { get; set; }
    public int TotalEnrolled { get; set; }
}

public class FaceIdentifyResult
{
    public bool Detected { get; set; }
    public string? Identity { get; set; }
    public double Confidence { get; set; }
    public string? Message { get; set; }
}
