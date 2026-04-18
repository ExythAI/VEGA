using Microsoft.AspNetCore.Mvc;
using VEGA.Interfaces;

namespace VEGA.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FaceController : ControllerBase
{
    private readonly IFaceRecognitionService _faceService;

    public FaceController(IFaceRecognitionService faceService)
    {
        _faceService = faceService;
    }

    [HttpPost("enroll")]
    public IActionResult Enroll([FromBody] FaceEnrollRequest request)
    {
        var result = _faceService.EnrollFace(request.Name ?? "", request.Image ?? "");
        return Ok(result);
    }

    [HttpPost("identify")]
    public IActionResult Identify([FromBody] FaceIdentifyRequest request)
    {
        var result = _faceService.IdentifyFace(request.Image ?? "");
        return Ok(result);
    }

    [HttpGet("enrolled")]
    public IActionResult GetEnrolled()
    {
        var users = _faceService.GetEnrolledUsers().Select(name => new { name });
        return Ok(users);
    }

    [HttpDelete("enrolled/{name}")]
    public IActionResult RemoveEnrolled(string name)
    {
        if (_faceService.RemoveUser(name))
            return Ok(new { success = true, message = $"Removed {name}." });
        return NotFound(new { error = $"No enrolled face named '{name}'." });
    }
}

public class FaceEnrollRequest
{
    public string? Name { get; set; }
    public string? Image { get; set; }
}

public class FaceIdentifyRequest
{
    public string? Image { get; set; }
}
